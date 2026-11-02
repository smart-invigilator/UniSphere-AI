"""
Behavior-analysis pipeline for live proctoring frames.

Key fixes compared to the previous version:

1. Head pose: the 3D reference model used a y-up / z-toward-camera
   convention while image points are y-down. solvePnP therefore always
   solved for a ~180 degree flip, so a perfectly frontal face came out as
   pitch = -180 -> permanently "Head Up" -> attention drained to 0.
   The model below is expressed in camera convention, so a frontal face
   gives yaw ~ 0, pitch ~ 0.

2. Attention: now a time-based exponential moving average of a per-frame
   "focus" value, measured RELATIVE to a per-student calibrated neutral
   pose (a laptop webcam usually sits below the eyes, so "looking at the
   screen" is never exactly 0/0 degrees to the camera).

3. Face detection: FaceMesh runs on the full-resolution frame in static
   image mode (the analyzer is shared by every student, so video/tracking
   mode mixed up faces between students) with a realistic 0.5 detection
   confidence instead of 0.9. A second/background face is now found.

4. Object detection (YOLOv8 ONNX): letterboxed input, per-class
   confidence thresholds, per-class NMS, person counting AFTER the loop
   (the old code only checked the person count inside the loop, for
   non-person classes, so "Additional Person Detected" almost never
   fired), and temporal smoothing + cooldown so real objects trigger
   reliably without flooding the teacher feed.
"""
from __future__ import annotations

import os
import time
import threading
from collections import deque

try:
    import numpy as np
    import cv2
    import mediapipe as mp
    _CV_OK = True
except Exception:
    np = None
    _CV_OK = False

from app.core.config import settings

# --------------------------------------------------------------------------
# Landmark indices (MediaPipe FaceMesh, 478 points with refine_landmarks)
# --------------------------------------------------------------------------
LEFT_EYE = [33, 160, 158, 133, 153, 144]      # eye on the IMAGE-left side
RIGHT_EYE = [362, 385, 387, 263, 373, 380]    # eye on the IMAGE-right side
LEFT_IRIS = [468, 469, 470, 471, 472]         # iris of LEFT_EYE
RIGHT_IRIS = [473, 474, 475, 476, 477]        # iris of RIGHT_EYE
POSE_IDS = [1, 152, 33, 263, 61, 291]         # nose, chin, eye corners, mouth corners
MOUTH_TOP, MOUTH_BOTTOM, MOUTH_LEFT, MOUTH_RIGHT = 13, 14, 61, 291

# 3D face model in CAMERA convention: x -> image right, y -> image DOWN,
# z -> AWAY from the camera. Order matches POSE_IDS.
MODEL_3D = None
if _CV_OK:
    MODEL_3D = np.array([
        [0.0, 0.0, 0.0],          # nose tip
        [0.0, 63.6, 12.5],        # chin
        [-43.3, -32.7, 26.0],     # eye corner, image-left
        [43.3, -32.7, 26.0],      # eye corner, image-right
        [-28.9, 28.9, 24.1],      # mouth corner, image-left
        [28.9, 28.9, 24.1],       # mouth corner, image-right
    ], dtype=np.float64)

# --------------------------------------------------------------------------
# Tunables
# --------------------------------------------------------------------------
EAR_THRESHOLD = 0.15
DROWSY_SECONDS = 3.0
MAR_THRESHOLD = 0.15

ALERT_COOLDOWN_SECONDS = 20
AWAY_EVENT_WINDOW_SECONDS = 60
AWAY_EVENT_REPEAT_THRESHOLD = 3
AWAY_ALERT_SECONDS = 1.5            # must look away this long before "Looking X" fires

# Deviations measured relative to the student's calibrated neutral pose.
HEAD_YAW_THRESHOLD = 20             # degrees
HEAD_PITCH_THRESHOLD = 18           # degrees
GAZE_H_THRESHOLD = 0.17             # iris ratio deviation (0..1 scale)
GAZE_V_THRESHOLD = 0.25             # vertical iris ratio is noisy -> lenient

CALIBRATION_SAMPLES = 8             # face-present frames used for the neutral pose
BASELINE_ADAPT_ALPHA = 0.02         # slow drift correction while focused

HEAD_MOVEMENT_WINDOW_SECONDS = 8
HEAD_MOVEMENT_MIN_SAMPLES = 4
HEAD_MOVEMENT_STEP_NOISE_FLOOR = 4
HEAD_MOVEMENT_CUM_THRESHOLD = 150
MOUTH_TRANSITION_WINDOW_SECONDS = 8
MOUTH_TRANSITION_THRESHOLD = 5

NO_FACE_ALERT_SECONDS = 2.0
MULTI_FACE_MIN_HITS = 2             # hits within the recent window
MULTI_FACE_WINDOW = 4               # analyzed frames
MULTI_FACE_COOLDOWN = 15

ATTENTION_TAU_SECONDS = 4.0         # EMA time constant for the attention score

# --------------------------------------------------------------------------
# Object detection (COCO class ids for YOLOv8)
# --------------------------------------------------------------------------
PERSON_COCO_ID = 0
# class_id -> (alert name, severity, min confidence)
COCO_FOCUS = {
    67: ("Phone Detected", "high", 0.30),                  # cell phone
    65: ("Electronic Device Detected", "medium", 0.40),    # remote (often a phone seen edge-on)
    73: ("Book Detected", "medium", 0.35),                 # book / notes
    62: ("External Screen Detected", "medium", 0.40),      # tv / monitor
    63: ("Additional Laptop Detected", "medium", 0.45),    # laptop / tablet
}
PERSON_MIN_CONF = 0.45
PERSON_MIN_AREA_FRAC = 0.01          # ignore tiny false-positive person boxes
OBJ_BASE_CONF = min(v[2] for v in COCO_FOCUS.values())
OBJ_HISTORY = 4                      # analyzed frames kept for smoothing
OBJ_MIN_HITS = 2                     # detections within OBJ_HISTORY frames
OBJ_INSTANT_CONF = 0.60              # a single frame this confident fires immediately
OBJ_INSTANT_CONF_BY_TYPE = {"Phone Detected": 0.45}   # phones are often shown only briefly
OBJ_COOLDOWN_SECONDS = 15


def _ear(pts):
    A = np.linalg.norm(pts[1] - pts[5])
    B = np.linalg.norm(pts[2] - pts[4])
    C = np.linalg.norm(pts[0] - pts[3])
    return (A + B) / (2.0 * C + 1e-6)


def _resolve_path(path: str) -> str:
    """Accept paths relative to the current dir OR to the backend root, so the
    model is found no matter which directory uvicorn is started from."""
    if os.path.exists(path):
        return os.path.abspath(path)
    backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(backend_root, path)


class StudentState:
    def __init__(self):
        now = time.time()
        self.closed_frames = 0
        self.closed_since: float | None = None
        self.away_frames = 0
        self.away_since: float | None = None
        self.away_alerted = False
        self.missing_frames = 0
        self.missing_since: float | None = None
        self.no_face_alerted = False
        self.blink_count = 0
        self.attention = 100.0
        self.last_attention_ts = now
        self.last_present = True
        self.face_id = None
        self.dark_frames = 0
        self.bright_frames = 0
        self.blur_frames = 0
        self.covered_frames = 0
        self.away_events: list[float] = []
        self.last_repeated_away_alert = 0.0
        self.yaw_history: list[tuple[float, float]] = []
        self.last_excessive_movement_alert = 0.0
        self.mouth_open = False
        self.mouth_transitions: list[float] = []
        self.last_lips_alert = 0.0

        # Neutral-pose calibration
        self.calib_samples: list[tuple[float, float, float, float]] = []
        self.baseline: dict | None = None

        # Multi-face / object smoothing
        self.multi_face_hist: deque = deque(maxlen=MULTI_FACE_WINDOW)
        self.last_multi_face_alert = 0.0
        self.obj_hist: dict[str, deque] = {}
        self.obj_last_alert: dict[str, float] = {}


class FrameAnalyzer:
    def __init__(self):
        self.ready = False
        self.face_det_available = False
        self.obj_session = None
        self.obj_providers: list[str] = []
        self._obj_input = None
        self._obj_size = (640, 640)
        self._tls = threading.local()
        if _CV_OK and settings.ENABLE_AI:
            self._init_models()

    @staticmethod
    def _new_face_mesh():
        return mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=4,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    @staticmethod
    def _new_face_det():
        return mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.5,
        )

    def _mesh(self):
        mesh = getattr(self._tls, "face_mesh", None)
        if mesh is None:
            mesh = self._new_face_mesh()
            self._tls.face_mesh = mesh
        return mesh

    def _det(self):
        if not self.face_det_available:
            return None
        det = getattr(self._tls, "face_det", None)
        if det is None:
            det = self._new_face_det()
            self._tls.face_det = det
        return det

    def warm_worker(self):
        if not self.ready:
            return
        blank = np.zeros((240, 320, 3), dtype=np.uint8)
        self._mesh().process(blank)
        det = self._det()
        if det is not None:
            det.process(blank)
        if self.obj_session is not None:
            tw, th = self._obj_size
            dummy = np.zeros((1, 3, th, tw), dtype=np.float32)
            self.obj_session.run(None, {self._obj_input: dummy})

    # ------------------------------------------------------------------ init
    def _init_models(self):
        try:
            probe = self._new_face_mesh()
            probe.close()
            self.ready = True
            print("[AI] Face mesh available (one instance per AI worker)")
        except Exception as e:
            print(f"[AI] Face mesh init failed: {e}")
        try:
            probe = self._new_face_det()
            probe.close()
            self.face_det_available = True
        except Exception as e:
            print(f"[AI] Face detector init failed (multi-face uses FaceMesh only): {e}")

        model_path = _resolve_path(settings.OBJECT_MODEL_PATH)
        if os.path.exists(model_path):
            try:
                from app.ai.engine import engine
                self.obj_session, self.obj_providers = engine.create_session(model_path)
                inp = self.obj_session.get_inputs()[0]
                self._obj_input = inp.name
                shape = inp.shape
                if len(shape) == 4 and isinstance(shape[2], int) and isinstance(shape[3], int):
                    self._obj_size = (shape[3], shape[2])
                print(f"[AI] Object model loaded: {model_path} input={self._obj_size} providers={self.obj_providers}")
            except Exception as e:
                print(f"[AI] Object model load failed: {e}")
        else:
            print(f"[AI] WARNING: object model NOT FOUND at {model_path}. "
                  f"Phone / book / screen / extra-person detection is DISABLED. "
                  f"See backend/README.md to export yolov8n.onnx.")

    # --------------------------------------------------------------- analyze
    def analyze(self, frame_bgr, state: StudentState) -> dict:
        """Return a dict of metrics + a list of triggered alert dicts."""
        if not self.ready:
            return self._fallback(state)
        from app.ai.engine import engine
        if not engine.in_worker():
            return engine.run(self.analyze, frame_bgr, state)

        now = time.time()
        h, w = frame_bgr.shape[:2]
        small = cv2.resize(frame_bgr, (0, 0), fx=0.5, fy=0.5)
        gray_small = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        alerts: list[dict] = []
        metrics = {"gaze": "—", "head": "—", "eye": "open", "faces": 0,
                   "persons": 0, "objects": []}
        landmarks = None
        focus = 0.0  # instantaneous focus 0..1 for this frame

        alerts.extend(self._check_camera_health(gray_small, metrics, state))

        # Full-resolution frame for face detection: at half resolution a
        # second person in the background is often too small to detect.
        rgb = np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB), dtype=np.uint8)
        res = self._mesh().process(rgb)
        faces = self._filter_faces(res.multi_face_landmarks or [])
        face_count = max(len(faces), self._count_faces(frame_bgr, rgb))
        metrics["faces"] = face_count

        # ------------------------------------------------------- no face
        if len(faces) == 0:
            state.missing_frames += 1
            if state.missing_since is None:
                state.missing_since = now
            if (not state.no_face_alerted) and now - state.missing_since >= NO_FACE_ALERT_SECONDS:
                alerts.append(_mk("No Face Detected", "high", 0.95))
                state.no_face_alerted = True
            metrics["present"] = False
            metrics["head"] = "No face"
            state.away_frames = 0
            state.away_since = None
            state.away_alerted = False
            focus = 0.0
            state.multi_face_hist.append(False)
        else:
            state.missing_frames = 0
            state.missing_since = None
            state.no_face_alerted = False
            metrics["present"] = True

            # -------------------------------------------- multiple faces
            state.multi_face_hist.append(face_count > 1)
            if (sum(state.multi_face_hist) >= MULTI_FACE_MIN_HITS
                    and now - state.last_multi_face_alert > MULTI_FACE_COOLDOWN):
                alerts.append(_mk("Multiple Faces", "high", 0.9))
                state.last_multi_face_alert = now

            # Primary face = the largest one (the candidate sitting closest).
            lm = self._largest_face(faces)
            landmarks = lm
            focus = self._analyze_primary_face(lm, w, h, metrics, state, alerts, now)
            if face_count > 1:
                focus *= 0.5

        # ------------------------------------------------ object detection
        if self.obj_session is not None:
            try:
                alerts.extend(self._detect_objects(frame_bgr, state, metrics, now))
            except Exception as e:
                print(f"[AI] object detection error: {e}")

        # ---------------------------------------------------- attention
        dt = max(0.0, min(5.0, now - state.last_attention_ts))
        state.last_attention_ts = now
        alpha = 1.0 - float(np.exp(-dt / ATTENTION_TAU_SECONDS)) if dt > 0 else 0.15
        state.attention = (1 - alpha) * state.attention + alpha * (focus * 100.0)
        state.attention = max(0.0, min(100.0, state.attention))

        metrics["attention"] = int(round(state.attention))
        metrics["blinks"] = state.blink_count
        metrics["calibrated"] = state.baseline is not None
        return {"metrics": metrics, "alerts": alerts, "landmarks": landmarks}

    # ------------------------------------------------------- primary face
    def _analyze_primary_face(self, lm, w, h, metrics, state, alerts, now) -> float:
        def px(i):
            return np.array([lm[i].x * w, lm[i].y * h])

        # ---- eyes open / closed
        le = np.array([px(i) for i in LEFT_EYE])
        re = np.array([px(i) for i in RIGHT_EYE])
        ear = (_ear(le) + _ear(re)) / 2.0
        eyes_closed_long = False
        if ear < EAR_THRESHOLD:
            state.closed_frames += 1
            if state.closed_since is None:
                state.closed_since = now
            if now - state.closed_since >= DROWSY_SECONDS:
                eyes_closed_long = True
        else:
            if 1 <= state.closed_frames <= 2:
                state.blink_count += 1
            state.closed_frames = 0
            state.closed_since = None
        if eyes_closed_long:
            metrics["eye"] = "closed"
            if not getattr(state, "eyes_alerted", False):
                eye_conf = min(0.99, 0.5 + (EAR_THRESHOLD - ear) / EAR_THRESHOLD)
                alerts.append(_mk("Eyes closed", "medium", eye_conf))
                state.eyes_alerted = True
        else:
            metrics["eye"] = "open"
            state.eyes_alerted = False

        # ---- gaze (average of both irises)
        h_ratio, v_ratio = self._gaze_ratios(lm, w, h, le, re)

        # ---- mouth
        alerts.extend(self._check_mouth(lm, w, h, metrics, state))

        # ---- head pose
        yaw, pitch = self._head_pose(lm, w, h)

        # ---- calibration of the neutral (looking-at-screen) pose
        if state.baseline is None:
            if yaw is not None and ear >= EAR_THRESHOLD:
                state.calib_samples.append((yaw, pitch, h_ratio, v_ratio))
            if len(state.calib_samples) >= CALIBRATION_SAMPLES:
                med = np.median(np.array(state.calib_samples), axis=0)
                state.baseline = {
                    "yaw": float(np.clip(med[0], -15, 15)),
                    "pitch": float(np.clip(med[1], -25, 25)),
                    "h": float(np.clip(med[2], 0.38, 0.62)),
                    "v": float(np.clip(med[3], 0.30, 0.70)),
                }
            metrics["gaze"] = "Calibrating"
            metrics["head"] = "Calibrating"
            # During the first few seconds a visible, eyes-open face = focused.
            return 0.3 if eyes_closed_long else 1.0

        b = state.baseline
        d_h = h_ratio - b["h"]
        d_v = v_ratio - b["v"]

        direction = None
        head_away = False
        d_yaw = d_pitch = 0.0
        if yaw is not None:
            d_yaw = yaw - b["yaw"]
            d_pitch = pitch - b["pitch"]
            metrics["yaw"] = round(d_yaw, 1)
            metrics["pitch"] = round(d_pitch, 1)
            # yaw > 0 => student turned to THEIR OWN left (see _head_pose()).
            if d_yaw > HEAD_YAW_THRESHOLD:
                metrics["head"] = "Head Left"; direction = "Looking Left"; head_away = True
            elif d_yaw < -HEAD_YAW_THRESHOLD:
                metrics["head"] = "Head Right"; direction = "Looking Right"; head_away = True
            elif d_pitch > HEAD_PITCH_THRESHOLD:
                metrics["head"] = "Head Down"; direction = "Looking Down"; head_away = True
            elif d_pitch < -HEAD_PITCH_THRESHOLD:
                metrics["head"] = "Head Up"; direction = "Looking Up"; head_away = True
            else:
                metrics["head"] = "Forward"
            alerts.extend(self._check_head_movement(yaw, state))

        # Iris direction (only meaningful when the eyes are open)
        gaze_away = False
        if ear >= EAR_THRESHOLD:
            if d_h > GAZE_H_THRESHOLD:
                metrics["gaze"] = "Left"; gaze_away = True; direction = direction or "Looking Left"
            elif d_h < -GAZE_H_THRESHOLD:
                metrics["gaze"] = "Right"; gaze_away = True; direction = direction or "Looking Right"
            elif d_v > GAZE_V_THRESHOLD:
                metrics["gaze"] = "Down"; gaze_away = True; direction = direction or "Looking Down"
            elif d_v < -GAZE_V_THRESHOLD:
                metrics["gaze"] = "Up"; gaze_away = True; direction = direction or "Looking Up"
            else:
                metrics["gaze"] = "Center"

        # ---- looking-away bookkeeping + alert (sustained only)
        if direction:
            state.away_frames += 1
            if state.away_since is None:
                state.away_since = now
            if (not state.away_alerted) and now - state.away_since >= AWAY_ALERT_SECONDS:
                dev = max(abs(d_h) - GAZE_H_THRESHOLD,
                          (abs(d_yaw) - HEAD_YAW_THRESHOLD) / 30,
                          (abs(d_pitch) - HEAD_PITCH_THRESHOLD) / 30)
                direction_conf = min(0.95, max(0.55, 0.65 + dev))
                alerts.append(_mk(direction, "low", direction_conf))
                alerts.extend(self._check_repeated_away(state))
                state.away_alerted = True
        else:
            state.away_frames = 0
            state.away_since = None
            state.away_alerted = False
            # Slowly follow posture drift while the student is focused.
            a = BASELINE_ADAPT_ALPHA
            if yaw is not None:
                b["yaw"] = (1 - a) * b["yaw"] + a * yaw
                b["pitch"] = (1 - a) * b["pitch"] + a * pitch
            if ear >= EAR_THRESHOLD:
                b["h"] = (1 - a) * b["h"] + a * h_ratio
                b["v"] = (1 - a) * b["v"] + a * v_ratio

        # ---- instantaneous focus value
        if eyes_closed_long:
            return 0.2
        if head_away:
            return 0.15
        if gaze_away:
            return 0.45
        return 1.0

    def _gaze_ratios(self, lm, w, h, le, re):
        def iris_center(ids):
            return np.array([[lm[i].x * w, lm[i].y * h] for i in ids]).mean(axis=0)

        def ratios(eye, iris):
            # eye[0] and eye[3] are the two horizontal corners
            x0, x1 = eye[0][0], eye[3][0]
            hr = (iris[0] - min(x0, x1)) / (abs(x1 - x0) + 1e-6)
            top = (eye[1][1] + eye[2][1]) / 2
            bottom = (eye[4][1] + eye[5][1]) / 2
            vr = (iris[1] - top) / (bottom - top + 1e-6)
            return hr, vr

        h1, v1 = ratios(le, iris_center(LEFT_IRIS))
        h2, v2 = ratios(re, iris_center(RIGHT_IRIS))
        return float((h1 + h2) / 2), float(np.clip((v1 + v2) / 2, -1, 2))

    def _head_pose(self, lm, w, h):
        """Return (yaw, pitch) in degrees. yaw > 0 => student's own LEFT,
        pitch > 0 => head tilted DOWN. (None, None) on failure."""
        img_pts = np.array([[lm[i].x * w, lm[i].y * h] for i in POSE_IDS], dtype=np.float64)
        cam = np.array([[w, 0, w / 2], [0, w, h / 2], [0, 0, 1]], dtype=np.float64)
        try:
            ok, rvec, _ = cv2.solvePnP(MODEL_3D, img_pts, cam, np.zeros((4, 1)),
                                       flags=cv2.SOLVEPNP_ITERATIVE)
        except cv2.error:
            return None, None
        if not ok:
            return None, None
        rmat, _ = cv2.Rodrigues(rvec)
        ang, *_ = cv2.RQDecomp3x3(rmat)
        pitch, yaw = float(ang[0]), float(ang[1])
        # Guard against the occasional equivalent-angle representation.
        if pitch > 90:
            pitch -= 180
        elif pitch < -90:
            pitch += 180
        # Raw positive yaw moves the nose to IMAGE-left = student's own right
        # (frames are unmirrored), so flip to "positive = student's left".
        return -yaw, pitch

    def _count_faces(self, frame_bgr, rgb=None) -> int:
        """Count faces with the full-range detector on the whole frame plus
        two overlapping halves (each half is effectively zoomed 2x, so a
        small face in the background is still found). Overlapping boxes
        from different tiles are merged."""
        det = self._det()
        if det is None:
            return 0
        H, W = frame_bgr.shape[:2]
        if rgb is None:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        tiles = [(0, W), (0, int(W * 0.6)), (int(W * 0.4), W)]
        boxes = []
        for x0, x1 in tiles:
            tile = np.ascontiguousarray(rgb[:, x0:x1])
            res = det.process(tile)
            for d in res.detections or []:
                b = d.location_data.relative_bounding_box
                tw = x1 - x0
                bx = (x0 + b.xmin * tw, b.ymin * H, b.width * tw, b.height * H)
                if bx[2] * bx[3] < 0.002 * W * H:
                    continue
                boxes.append((bx, float(d.score[0])))
        kept = []
        for bx, sc in sorted(boxes, key=lambda t: -t[1]):
            dup = False
            for kb, _ in kept:
                ix = max(0.0, min(bx[0] + bx[2], kb[0] + kb[2]) - max(bx[0], kb[0]))
                iy = max(0.0, min(bx[1] + bx[3], kb[1] + kb[3]) - max(bx[1], kb[1]))
                if ix * iy / (min(bx[2] * bx[3], kb[2] * kb[3]) + 1e-6) > 0.3:
                    dup = True
                    break
            if not dup:
                kept.append((bx, sc))
        return len(kept)

    @staticmethod
    def _filter_faces(faces):
        """Drop implausibly tiny detections (noise / posters far away)."""
        kept = []
        for f in faces:
            xs = [p.x for p in f.landmark]
            ys = [p.y for p in f.landmark]
            if (max(xs) - min(xs)) * (max(ys) - min(ys)) >= 0.002:
                kept.append(f)
        return kept

    # -------------------------------------------------------- camera health
    def _check_camera_health(self, gray, metrics, state: StudentState) -> list[dict]:
        mean = float(gray.mean())
        std = float(gray.std())
        blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        metrics["brightness"] = round(mean, 1)
        metrics["blur"] = round(blur_var, 1)

        covered = mean < settings.CAMERA_COVERED_MEAN and std < settings.CAMERA_COVERED_STD
        low_light = (not covered) and mean < settings.CAMERA_LOW_LIGHT_MEAN
        overexposed = mean > settings.CAMERA_OVEREXPOSED_MEAN
        blurry = blur_var < settings.CAMERA_BLUR_VARIANCE_THRESHOLD

        alerts = []

        def _track(flag, counter_name, alert_type, severity, confidence):
            count = getattr(state, counter_name)
            if flag:
                count += 1
                if count == settings.CAMERA_ISSUE_FRAMES:
                    alerts.append(_mk(alert_type, severity, confidence))
            else:
                count = 0
            setattr(state, counter_name, count)

        cov_conf = min(0.99, 0.6 + (settings.CAMERA_COVERED_MEAN - mean) / settings.CAMERA_COVERED_MEAN) if covered else 0.9
        dark_conf = min(0.95, 0.6 + (settings.CAMERA_LOW_LIGHT_MEAN - mean) / settings.CAMERA_LOW_LIGHT_MEAN) if low_light else 0.75
        bright_conf = min(0.95, 0.6 + (mean - settings.CAMERA_OVEREXPOSED_MEAN) / 100) if overexposed else 0.7
        blur_conf = min(0.9, 0.5 + (settings.CAMERA_BLUR_VARIANCE_THRESHOLD - blur_var) / settings.CAMERA_BLUR_VARIANCE_THRESHOLD) if blurry else 0.65

        _track(covered, "covered_frames", "Camera Covered", "high", cov_conf)
        _track(low_light, "dark_frames", "Low Light Detected", "medium", dark_conf)
        _track(overexposed, "bright_frames", "Overexposed Camera", "medium", bright_conf)
        _track(blurry, "blur_frames", "Blurry Camera", "low", blur_conf)
        return alerts

    # ---------------------------------------------------------------- mouth
    def _check_mouth(self, lm, sw, sh, metrics, state: StudentState) -> list[dict]:
        top = np.array([lm[MOUTH_TOP].x * sw, lm[MOUTH_TOP].y * sh])
        bottom = np.array([lm[MOUTH_BOTTOM].x * sw, lm[MOUTH_BOTTOM].y * sh])
        left = np.array([lm[MOUTH_LEFT].x * sw, lm[MOUTH_LEFT].y * sh])
        right = np.array([lm[MOUTH_RIGHT].x * sw, lm[MOUTH_RIGHT].y * sh])
        mar = np.linalg.norm(top - bottom) / (np.linalg.norm(left - right) + 1e-6)
        mouth_open_now = mar > MAR_THRESHOLD
        metrics["mouth"] = "open" if mouth_open_now else "closed"

        alerts = []
        now = time.time()
        if mouth_open_now != state.mouth_open:
            state.mouth_open = mouth_open_now
            state.mouth_transitions.append(now)
        state.mouth_transitions = [t for t in state.mouth_transitions if now - t <= MOUTH_TRANSITION_WINDOW_SECONDS]

        if (len(state.mouth_transitions) >= MOUTH_TRANSITION_THRESHOLD
                and now - state.last_lips_alert > ALERT_COOLDOWN_SECONDS):
            alerts.append(_mk("Lips Movement Detected", "low", 0.6))
            state.last_lips_alert = now
        return alerts

    # --------------------------------------------------------- head movement
    def _check_head_movement(self, yaw: float, state: StudentState) -> list[dict]:
        now = time.time()
        state.yaw_history.append((now, yaw))
        state.yaw_history = [(t, y) for (t, y) in state.yaw_history if now - t <= HEAD_MOVEMENT_WINDOW_SECONDS]

        alerts = []
        if len(state.yaw_history) >= HEAD_MOVEMENT_MIN_SAMPLES:
            cum = sum(
                d for d in (
                    abs(state.yaw_history[i][1] - state.yaw_history[i - 1][1])
                    for i in range(1, len(state.yaw_history))
                )
                if d >= HEAD_MOVEMENT_STEP_NOISE_FLOOR
            )
            if cum > HEAD_MOVEMENT_CUM_THRESHOLD and now - state.last_excessive_movement_alert > ALERT_COOLDOWN_SECONDS:
                movement_conf = min(0.95, 0.6 + (cum - HEAD_MOVEMENT_CUM_THRESHOLD) / HEAD_MOVEMENT_CUM_THRESHOLD)
                alerts.append(_mk("Excessive Head Movement Detected", "medium", movement_conf))
                state.last_excessive_movement_alert = now
        return alerts

    def _check_repeated_away(self, state: StudentState) -> list[dict]:
        now = time.time()
        state.away_events.append(now)
        state.away_events = [t for t in state.away_events if now - t <= AWAY_EVENT_WINDOW_SECONDS]

        alerts = []
        if (len(state.away_events) >= AWAY_EVENT_REPEAT_THRESHOLD
                and now - state.last_repeated_away_alert > ALERT_COOLDOWN_SECONDS):
            alerts.append(_mk("Repeated Looking Away Detected", "medium", 0.8))
            state.last_repeated_away_alert = now
        return alerts

    # --------------------------------------------- helpers used by the API
    def detect_face(self, frame_bgr, strict: bool = True):
        if not self.ready:
            return None
        from app.ai.engine import engine
        if not engine.in_worker():
            return engine.run(self.detect_face, frame_bgr, strict)
        rgb = np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB), dtype=np.uint8)
        res = self._mesh().process(rgb)
        faces = self._filter_faces(res.multi_face_landmarks or [])
        if not faces:
            return None
        if strict and len(faces) != 1:
            return None
        if len(faces) == 1:
            return faces[0].landmark
        return self._largest_face(faces)

    @staticmethod
    def _largest_face(faces):
        def area(face):
            xs = [p.x for p in face.landmark]
            ys = [p.y for p in face.landmark]
            return (max(xs) - min(xs)) * (max(ys) - min(ys))
        return max(faces, key=area).landmark

    def head_yaw(self, frame_bgr, landmarks) -> "float | None":
        """Yaw in degrees. POSITIVE = student turned to their OWN LEFT
        (frames are raw/unmirrored). Used by the liveness check."""
        if landmarks is None:
            return None
        h, w = frame_bgr.shape[:2]
        yaw, _ = self._head_pose(landmarks, w, h)
        return yaw

    # ----------------------------------------------------- object detection
    def _letterbox(self, frame):
        tw, th = self._obj_size
        h, w = frame.shape[:2]
        r = min(tw / w, th / h)
        nw, nh = int(round(w * r)), int(round(h * r))
        resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
        canvas = np.full((th, tw, 3), 114, dtype=np.uint8)
        dx, dy = (tw - nw) // 2, (th - nh) // 2
        canvas[dy:dy + nh, dx:dx + nw] = resized
        return canvas, r, dx, dy

    def _raw_detections(self, frame):
        """Run YOLO and return a list of (class_id, conf, [x, y, w, h]) in
        ORIGINAL frame pixels, after per-class NMS."""
        img, r, dx, dy = self._letterbox(frame)
        blob = np.ascontiguousarray(img[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
        out = self.obj_session.run(None, {self._obj_input: blob})[0]
        out = np.squeeze(out, axis=0)

        # YOLOv8 exports (84, N); some exports are (N, 84). YOLOv5 is (N, 85)
        # with an objectness column.
        if out.shape[0] < out.shape[1]:
            out = out.T
        if out.shape[1] == 85:
            cls_scores = out[:, 5:] * out[:, 4:5]
        else:
            cls_scores = out[:, 4:]
        boxes_xywh = out[:, :4]

        class_ids = np.argmax(cls_scores, axis=1)
        confs = cls_scores[np.arange(len(class_ids)), class_ids]
        mask = confs >= min(OBJ_BASE_CONF, PERSON_MIN_CONF)
        if not np.any(mask):
            return []
        boxes_xywh, class_ids, confs = boxes_xywh[mask], class_ids[mask], confs[mask]

        # cx,cy,w,h (letterboxed) -> x,y,w,h (original frame pixels)
        x = (boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2 - dx) / r
        y = (boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2 - dy) / r
        bw = boxes_xywh[:, 2] / r
        bh = boxes_xywh[:, 3] / r
        boxes = np.stack([x, y, bw, bh], axis=1)

        results = []
        for cid in np.unique(class_ids):
            idx = np.where(class_ids == cid)[0]
            keep = cv2.dnn.NMSBoxes(boxes[idx].tolist(), confs[idx].astype(float).tolist(),
                                    score_threshold=0.0, nms_threshold=0.45)
            for k in np.array(keep).reshape(-1):
                i = idx[int(k)]
                results.append((int(cid), float(confs[i]), boxes[i].tolist()))
        return results

    def _detect_objects(self, frame, state: StudentState, metrics: dict, now: float) -> list[dict]:
        fh, fw = frame.shape[:2]
        frame_area = float(fw * fh)
        dets = self._raw_detections(frame)

        found: dict[str, tuple[float, str]] = {}   # alert name -> (best conf, severity)
        person_confs = []
        for cid, conf, (_x, _y, bw, bh) in dets:
            if cid == PERSON_COCO_ID:
                if conf >= PERSON_MIN_CONF and (bw * bh) / frame_area >= PERSON_MIN_AREA_FRAC:
                    person_confs.append(conf)
                continue
            if cid in COCO_FOCUS:
                name, sev, min_conf = COCO_FOCUS[cid]
                if conf >= min_conf and (name not in found or conf > found[name][0]):
                    found[name] = (conf, sev)

        # Counted AFTER looking at every detection (this was the old bug).
        if len(person_confs) >= 2:
            second = sorted(person_confs, reverse=True)[1]
            found["Additional Person Detected"] = (second, "high")

        metrics["persons"] = len(person_confs)
        metrics["objects"] = [{"type": k, "confidence": round(v[0], 2)} for k, v in found.items()]

        # Temporal smoothing: an object must be seen in OBJ_MIN_HITS of the
        # last OBJ_HISTORY frames (or once with high confidence), then a
        # per-type cooldown prevents repeated alerts for the same object.
        alerts = []
        for name in set(state.obj_hist.keys()) | set(found.keys()):
            hist = state.obj_hist.setdefault(name, deque(maxlen=OBJ_HISTORY))
            hit = found.get(name)
            hist.append(hit[0] if hit else 0.0)
            if not hit:
                continue
            hits = sum(1 for c in hist if c > 0)
            conf, sev = hit
            instant = OBJ_INSTANT_CONF_BY_TYPE.get(name, OBJ_INSTANT_CONF)
            confirmed = hits >= OBJ_MIN_HITS or conf >= instant
            if confirmed and now - state.obj_last_alert.get(name, 0.0) > OBJ_COOLDOWN_SECONDS:
                alerts.append(_mk(name, sev, max(hist)))
                state.obj_last_alert[name] = now
        return alerts

    # --------------------------------------------------------------- misc
    def _fallback(self, state: StudentState) -> dict:
        return {"metrics": {"attention": int(state.attention), "gaze": "—",
                            "head": "—", "eye": "open", "faces": 1,
                            "present": True, "blinks": 0}, "alerts": [], "landmarks": None}


def _mk(alert_type: str, severity: str, confidence: float) -> dict:
    return {"alert_type": alert_type, "severity": severity,
            "confidence": round(float(confidence), 3), "ts": time.time()}


analyzer = FrameAnalyzer()