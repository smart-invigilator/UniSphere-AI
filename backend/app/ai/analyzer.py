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

LEFT_EYE = [33, 160, 158, 133, 153, 144]      
RIGHT_EYE = [362, 385, 387, 263, 373, 380]  
LEFT_IRIS = [468, 469, 470, 471, 472]     
RIGHT_IRIS = [473, 474, 475, 476, 477]  
POSE_IDS = [1, 152, 33, 263, 61, 291] 
MOUTH_TOP, MOUTH_BOTTOM, MOUTH_LEFT, MOUTH_RIGHT = 13, 14, 61, 291
MODEL_3D = None
if _CV_OK:
    MODEL_3D = np.array([
        [0.0, 0.0, 0.0],          
        [0.0, 63.6, 12.5],      
        [-43.3, -32.7, 26.0],   
        [43.3, -32.7, 26.0],     
        [-28.9, 28.9, 24.1],    
        [28.9, 28.9, 24.1],     
    ], dtype=np.float64)
EAR_THRESHOLD = 0.15
DROWSY_SECONDS = 3.0
MAR_THRESHOLD = 0.15

ALERT_COOLDOWN_SECONDS = 20
AWAY_EVENT_WINDOW_SECONDS = 60
AWAY_EVENT_REPEAT_THRESHOLD = 3
AWAY_ALERT_SECONDS = 1.5         
HEAD_YAW_THRESHOLD = 20            
HEAD_PITCH_THRESHOLD = 18         
GAZE_H_THRESHOLD = 0.17            
GAZE_V_THRESHOLD = 0.25          

CALIBRATION_SAMPLES = 8             
BASELINE_ADAPT_ALPHA = 0.02         
HEAD_MOVEMENT_WINDOW_SECONDS = 8
HEAD_MOVEMENT_MIN_SAMPLES = 4
HEAD_MOVEMENT_STEP_NOISE_FLOOR = 4
HEAD_MOVEMENT_CUM_THRESHOLD = 150
MOUTH_TRANSITION_WINDOW_SECONDS = 8
MOUTH_TRANSITION_THRESHOLD = 5

NO_FACE_ALERT_SECONDS = 2.0
MULTI_FACE_MIN_HITS = 2           
MULTI_FACE_WINDOW = 4             
MULTI_FACE_COOLDOWN = 15

ATTENTION_TAU_SECONDS = 4.0       
PERSON_COCO_ID = 0
COCO_FOCUS = {
    67: ("Phone Detected", "high", 0.30),                  
    65: ("Electronic Device Detected", "medium", 0.40),   
    73: ("Book Detected", "medium", 0.35),                
    62: ("External Screen Detected", "medium", 0.40),    
    63: ("Additional Laptop Detected", "medium", 0.45),   
}
PERSON_MIN_CONF = 0.45
PERSON_MIN_AREA_FRAC = 0.01        
OBJ_BASE_CONF = min(v[2] for v in COCO_FOCUS.values())
OBJ_HISTORY = 4                    
OBJ_MIN_HITS = 2                 
OBJ_INSTANT_CONF = 0.60           
OBJ_INSTANT_CONF_BY_TYPE = {"Phone Detected": 0.45}   
OBJ_COOLDOWN_SECONDS = 15


def _ear(pts):
    A = np.linalg.norm(pts[1] - pts[5])
    B = np.linalg.norm(pts[2] - pts[4])
    C = np.linalg.norm(pts[0] - pts[3])
    return (A + B) / (2.0 * C + 1e-6)


def _resolve_path(path: str) -> str:
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
        self.calib_samples: list[tuple[float, float, float, float]] = []
        self.baseline: dict | None = None
        self.multi_face_hist: deque = deque(maxlen=MULTI_FACE_WINDOW)
        self.last_multi_face_alert = 0.0
        self.obj_hist: dict[str, deque] = {}
        self.obj_last_alert: dict[str, float] = {}


class FrameAnalyzer:
    def __init__(self):
        self.ready = False
        self.face_mesh = None
        self.face_det = None
        self.obj_session = None
        self._obj_input = None
        self._obj_size = (640, 640)
        self._face_mesh_lock = threading.Lock()
        if _CV_OK and settings.ENABLE_AI:
            self._init_models()
    def _init_models(self):
        try:
            self.face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=4,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.ready = True
            print("[AI] Face mesh loaded")
        except Exception as e:
            print(f"[AI] Face mesh init failed: {e}")
        try:
            self.face_det = mp.solutions.face_detection.FaceDetection(
                model_selection=1, min_detection_confidence=0.5,
            )
        except Exception as e:
            print(f"[AI] Face detector init failed (multi-face uses FaceMesh only): {e}")

        model_path = _resolve_path(settings.OBJECT_MODEL_PATH)
        if os.path.exists(model_path):
            try:
                import onnxruntime as ort
                self.obj_session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
                inp = self.obj_session.get_inputs()[0]
                self._obj_input = inp.name
                shape = inp.shape
                if len(shape) == 4 and isinstance(shape[2], int) and isinstance(shape[3], int):
                    self._obj_size = (shape[3], shape[2])
                print(f"[AI] Object model loaded: {model_path} input={self._obj_size}")
            except Exception as e:
                print(f"[AI] Object model load failed: {e}")
        else:
            print(f"[AI] WARNING: object model NOT FOUND at {model_path}. "
                  f"Phone / book / screen / extra-person detection is DISABLED. "
                  f"See backend/README.md to export yolov8n.onnx.")

    def analyze(self, frame_bgr, state: StudentState) -> dict:
        """Return a dict of metrics + a list of triggered alert dicts."""
        if not self.ready:
            return self._fallback(state)

        now = time.time()
        h, w = frame_bgr.shape[:2]
        small = cv2.resize(frame_bgr, (0, 0), fx=0.5, fy=0.5)
        gray_small = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        alerts: list[dict] = []
        metrics = {"gaze": "—", "head": "—", "eye": "open", "faces": 0,
                   "persons": 0, "objects": []}
        landmarks = None
        focus = 0.0 

        alerts.extend(self._check_camera_health(gray_small, metrics, state))
        rgb = np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB), dtype=np.uint8)
        with self._face_mesh_lock:
            res = self.face_mesh.process(rgb)
        faces = self._filter_faces(res.multi_face_landmarks or [])
        face_count = max(len(faces), self._count_faces(frame_bgr))
        metrics["faces"] = face_count
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
            state.multi_face_hist.append(face_count > 1)
            if (sum(state.multi_face_hist) >= MULTI_FACE_MIN_HITS
                    and now - state.last_multi_face_alert > MULTI_FACE_COOLDOWN):
                alerts.append(_mk("Multiple Faces", "high", 0.9))
                state.last_multi_face_alert = now
            lm = self._largest_face(faces)
            landmarks = lm
            focus = self._analyze_primary_face(lm, w, h, metrics, state, alerts, now)
            if face_count > 1:
                focus *= 0.5
        if self.obj_session is not None:
            try:
                alerts.extend(self._detect_objects(frame_bgr, state, metrics, now))
            except Exception as e:
                print(f"[AI] object detection error: {e}")
        dt = max(0.0, min(5.0, now - state.last_attention_ts))
        state.last_attention_ts = now
        alpha = 1.0 - float(np.exp(-dt / ATTENTION_TAU_SECONDS)) if dt > 0 else 0.15
        state.attention = (1 - alpha) * state.attention + alpha * (focus * 100.0)
        state.attention = max(0.0, min(100.0, state.attention))

        metrics["attention"] = int(round(state.attention))
        metrics["blinks"] = state.blink_count
        metrics["calibrated"] = state.baseline is not None
        return {"metrics": metrics, "alerts": alerts, "landmarks": landmarks}
    def _analyze_primary_face(self, lm, w, h, metrics, state, alerts, now) -> float:
        def px(i):
            return np.array([lm[i].x * w, lm[i].y * h])
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
        h_ratio, v_ratio = self._gaze_ratios(lm, w, h, le, re)

        alerts.extend(self._check_mouth(lm, w, h, metrics, state))
        yaw, pitch = self._head_pose(lm, w, h)
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
            a = BASELINE_ADAPT_ALPHA
            if yaw is not None:
                b["yaw"] = (1 - a) * b["yaw"] + a * yaw
                b["pitch"] = (1 - a) * b["pitch"] + a * pitch
            if ear >= EAR_THRESHOLD:
                b["h"] = (1 - a) * b["h"] + a * h_ratio
                b["v"] = (1 - a) * b["v"] + a * v_ratio

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
        if pitch > 90:
            pitch -= 180
        elif pitch < -90:
            pitch += 180
        return -yaw, pitch

    def _count_faces(self, frame_bgr) -> int:
        if self.face_det is None:
            return 0
        H, W = frame_bgr.shape[:2]
        tiles = [(0, W), (0, int(W * 0.6)), (int(W * 0.4), W)]
        boxes = []
        with self._face_mesh_lock:
            for x0, x1 in tiles:
                tile = np.ascontiguousarray(cv2.cvtColor(frame_bgr[:, x0:x1], cv2.COLOR_BGR2RGB))
                res = self.face_det.process(tile)
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
        kept = []
        for f in faces:
            xs = [p.x for p in f.landmark]
            ys = [p.y for p in f.landmark]
            if (max(xs) - min(xs)) * (max(ys) - min(ys)) >= 0.002:
                kept.append(f)
        return kept

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

    def detect_face(self, frame_bgr, strict: bool = True):
        if not self.ready:
            return None
        rgb = np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB), dtype=np.uint8)
        with self._face_mesh_lock:
            res = self.face_mesh.process(rgb)
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
        if landmarks is None:
            return None
        h, w = frame_bgr.shape[:2]
        yaw, _ = self._head_pose(landmarks, w, h)
        return yaw

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
        img, r, dx, dy = self._letterbox(frame)
        blob = np.ascontiguousarray(img[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
        out = self.obj_session.run(None, {self._obj_input: blob})[0]
        out = np.squeeze(out, axis=0)
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

        found: dict[str, tuple[float, str]] = {}   
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
        if len(person_confs) >= 2:
            second = sorted(person_confs, reverse=True)[1]
            found["Additional Person Detected"] = (second, "high")

        metrics["persons"] = len(person_confs)
        metrics["objects"] = [{"type": k, "confidence": round(v[0], 2)} for k, v in found.items()]
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
    def _fallback(self, state: StudentState) -> dict:
        return {"metrics": {"attention": int(state.attention), "gaze": "—",
                            "head": "—", "eye": "open", "faces": 1,
                            "present": True, "blinks": 0}, "alerts": [], "landmarks": None}


def _mk(alert_type: str, severity: str, confidence: float) -> dict:
    return {"alert_type": alert_type, "severity": severity,
            "confidence": round(float(confidence), 3), "ts": time.time()}


analyzer = FrameAnalyzer()