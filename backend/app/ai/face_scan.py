from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

try:
    import numpy as np
    import cv2
    _CV_OK = True
except Exception:
    np = None
    cv2 = None
    _CV_OK = False

from app.core.config import settings
from app.ai.analyzer import analyzer
from app.ai.face_id import face_identifier
from app.ai.utils import decode_b64_jpeg
from app.ai.engine import on_ai_worker

logger = logging.getLogger(__name__)

GALLERY_VERSION = 1
MAX_TEMPLATES_PER_BIN = 3
MAX_FRAME_SIDE = 640

ALL_LABELS = ["front", "left_25", "left_45", "left_65", "profile_left", "right_25", "right_45", "right_65", "profile_right"]
# A slight turn (left_25 / right_25) is still stored in the gallery but does
# not satisfy a side on its own: the student must turn the head well over.
REQUIRED_GROUPS = {
    "front": ["front"],
    "left": ["left_45", "left_65", "profile_left"],
    "right": ["right_45", "right_65", "profile_right"],
}
GROUP_TEXT = {"front": "straight ahead", "left": "turned well to your left", "right": "turned well to your right"}
PROFILE_LABELS = {"profile_left", "profile_right"}

CHAINS = [
    ["front", "left_25", "left_45", "left_65", "profile_left"],
    ["front", "right_25", "right_45", "right_65", "profile_right"],
]

LABEL_TEXT = {
    "front": "straight ahead",
    "left_25": "slightly left",
    "left_45": "half left",
    "left_65": "far left",
    "profile_left": "full left side (90°)",
    "right_25": "slightly right",
    "right_45": "half right",
    "right_65": "far right",
    "profile_right": "full right side (90°)",
}

QUALITY_MESSAGES = {
    "too_dark": "It's too dark — face a light source.",
    "face_low_texture": "Your face isn't clear — improve the lighting.",
    "face_low_sharpness": "The image is blurry — move a little slower.",
    "face_not_aligned": "Couldn't read your face — hold still for a moment.",
    "eyes_covered": "Your eyes look covered — remove anything blocking them.",
    "mouth_covered": "Your mouth/chin looks covered — keep your face uncovered.",
    "face_low_texture_profile": "Your side profile isn't clear — improve the lighting.",
}


def mesh_label(yaw: float) -> str:
    a = abs(yaw)
    if a < settings.FACE_SCAN_FRONT_MAX_YAW:
        return "front"
    side = "left" if yaw > 0 else "right"
    if a < settings.FACE_SCAN_NEAR_MAX_YAW:
        return f"{side}_25"
    if a < settings.FACE_SCAN_MID_MAX_YAW:
        return f"{side}_45"
    return f"{side}_65"


def _downscale(frame):
    h, w = frame.shape[:2]
    m = max(h, w)
    if m <= MAX_FRAME_SIDE:
        return frame
    s = MAX_FRAME_SIDE / float(m)
    return cv2.resize(frame, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


class ProfileDetector:
    def __init__(self):
        self.ready = False
        self._cascade = None
        self._lock = threading.Lock()
        if not _CV_OK:
            return
        try:
            path = os.path.join(cv2.data.haarcascades, "haarcascade_profileface.xml")
            cascade = cv2.CascadeClassifier(path)
            if cascade.empty():
                print(f"[FaceScan] Profile cascade not found at {path}; side-profile recognition disabled.")
                return
            self._cascade = cascade
            self.ready = True
            print("[FaceScan] Profile face detector loaded")
        except Exception as e:
            print(f"[FaceScan] Profile detector init failed: {e}")

    def detect(self, frame_bgr, lenient: bool = False):
        if not self.ready:
            return None
        neighbors = settings.FACE_PROFILE_SCAN_MIN_NEIGHBORS if lenient else settings.FACE_PROFILE_MIN_NEIGHBORS
        min_weight = settings.FACE_PROFILE_SCAN_MIN_WEIGHT if lenient else settings.FACE_PROFILE_MIN_WEIGHT
        h, w = frame_bgr.shape[:2]
        gray = cv2.equalizeHist(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY))
        min_side = max(40, int(min(h, w) * settings.FACE_PROFILE_MIN_SIZE_RATIO))
        best = None
        for flipped in (False, True):
            g = cv2.flip(gray, 1) if flipped else gray
            with self._lock:
                try:
                    rects, _levels, weights = self._cascade.detectMultiScale3(
                        g, scaleFactor=1.1, minNeighbors=neighbors, minSize=(min_side, min_side),
                        outputRejectLevels=True,
                    )
                except cv2.error:
                    continue
            weights = np.ravel(weights) if len(rects) else []
            for rect, weight in zip(rects, weights):
                if best is None or float(weight) > best[0]:
                    best = (float(weight), tuple(int(v) for v in rect), flipped)
        if best is None or best[0] < min_weight:
            return None
        weight, (x, y, bw, bh), flipped = best
        src = cv2.flip(frame_bgr, 1) if flipped else frame_bgr
        pad = int(0.15 * max(bw, bh))
        side = max(bw, bh) + 2 * pad
        cx, cy = x + bw // 2, y + bh // 2
        x0, y0 = max(0, cx - side // 2), max(0, cy - side // 2)
        x1, y1 = min(w, x0 + side), min(h, y0 + side)
        crop = src[y0:y1, x0:x1]
        if crop.size == 0 or crop.shape[0] < 40 or crop.shape[1] < 40:
            return None
        return crop, weight


profile_detector = ProfileDetector()


@dataclass
class FrameResult:
    ok: bool
    kind: str | None = None
    label: str | None = None
    yaw: float | None = None
    embedding: object = None
    message: str = ""


def scan_ready() -> bool:
    return bool(_CV_OK and analyzer.ready and face_identifier.ready)


@on_ai_worker
def analyze_frame(frame_bgr, need_embedding: bool = True) -> FrameResult:
    if frame_bgr is None:
        return FrameResult(False, message="Camera frame could not be read.")
    frame = _downscale(frame_bgr)
    lm = analyzer.detect_face(frame, strict=True)
    if lm is None and analyzer.detect_face(frame, strict=False) is not None:
        return FrameResult(False, message="Only you should be visible to the camera.")
    if lm is not None:
        yaw = analyzer.head_yaw(frame, lm)
        if yaw is None:
            return FrameResult(False, message="Couldn't measure your head angle — hold still.")
        label = mesh_label(yaw)
        if label == "front":
            visible, aligned, reason = face_identifier.face_visibility_quality(frame, lm)
        else:
            aligned = face_identifier.align(frame, lm)
            visible, reason = face_identifier.basic_quality(aligned, settings.FACE_SCAN_SIDE_SHARPNESS_SCALE)
        if not visible:
            return FrameResult(False, "mesh", label, round(yaw, 1), message=QUALITY_MESSAGES.get(reason, "Face not clear."))
        emb = face_identifier.embed_crop(aligned) if need_embedding else None
        if need_embedding and emb is None:
            return FrameResult(False, "mesh", label, round(yaw, 1), message="Couldn't process your face — try again.")
        return FrameResult(True, "mesh", label, round(yaw, 1), emb, "")
    prof = profile_detector.detect(frame, lenient=True)
    if prof is not None:
        crop, _weight = prof
        ok, reason = face_identifier.basic_quality(crop, settings.FACE_SCAN_SIDE_SHARPNESS_SCALE)
        if not ok:
            return FrameResult(False, "profile", "profile", message=QUALITY_MESSAGES.get(f"{reason}_profile", QUALITY_MESSAGES.get(reason, "Side profile not clear.")))
        emb = face_identifier.embed_crop(cv2.resize(crop, (112, 112), interpolation=cv2.INTER_AREA)) if need_embedding else None
        if need_embedding and emb is None:
            return FrameResult(False, "profile", "profile", message="Couldn't process your side profile — try again.")
        return FrameResult(True, "profile", "profile", None, emb, "")
    return FrameResult(False, message="No face found — keep your head inside the frame.")


def _cos(a, b) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    return float(np.dot(va, vb) / ((np.linalg.norm(va) * np.linalg.norm(vb)) + 1e-8))


def _best(refs, embs) -> float:
    return max((_cos(r, e) for r in refs for e in embs), default=-1.0)


@dataclass
class ScanOutcome:
    bins: dict = field(default_factory=dict)
    front_image: str | None = None
    rejected: int = 0
    first_error: str = ""

    @property
    def missing(self) -> list[str]:
        return [g for g, labels in REQUIRED_GROUPS.items() if not any(l in self.bins for l in labels)]


@on_ai_worker
def process_scan(frames: list) -> ScanOutcome:
    out = ScanOutcome()
    front_score = -1.0
    for item in frames:
        hint = getattr(item, "label", "") or ""
        image = getattr(item, "image", "") or ""
        frame = decode_b64_jpeg(image)
        res = analyze_frame(frame, need_embedding=True)
        if not res.ok:
            out.rejected += 1
            if not out.first_error:
                out.first_error = res.message
            continue
        if res.kind == "profile":
            if hint not in PROFILE_LABELS:
                out.rejected += 1
                continue
            label = hint
        else:
            label = res.label
        bucket = out.bins.setdefault(label, [])
        if len(bucket) < MAX_TEMPLATES_PER_BIN:
            bucket.append(np.asarray(res.embedding, dtype=np.float32))
        if label == "front":
            score = -abs(res.yaw or 0.0)
            if score > front_score:
                front_score = score
                out.front_image = image.split(",", 1)[1] if "," in image else image
    return out


def check_consistency(bins: dict) -> tuple[bool, str]:
    for chain in CHAINS:
        present = [l for l in chain if l in bins]
        for a, b in zip(present, present[1:]):
            thr = settings.FACE_SCAN_PROFILE_CHAIN_THRESHOLD if b in PROFILE_LABELS else settings.FACE_SCAN_CHAIN_THRESHOLD
            sim = _best(bins[a], bins[b])
            if sim < thr:
                logger.info("face scan chain break %s->%s sim=%.3f thr=%.3f", a, b, sim, thr)
                return False, f"The {LABEL_TEXT[a]} and {LABEL_TEXT[b]} views don't look like the same person"
    return True, ""


def build_gallery(bins: dict) -> dict:
    return {
        "version": GALLERY_VERSION,
        "created": datetime.now(timezone.utc).isoformat(),
        "bins": {
            label: [[round(float(v), 5) for v in emb] for emb in embs]
            for label, embs in bins.items()
        },
    }


def front_average(bins: dict) -> list[float] | None:
    embs = bins.get("front") or []
    if not embs:
        return None
    return face_identifier.average_embedding(embs)


def is_gallery(ref) -> bool:
    return isinstance(ref, dict) and isinstance(ref.get("bins"), dict) and bool(ref["bins"])


def _neighbors(label: str) -> list[str]:
    if label == "front":
        return ["front", "left_25", "right_25"]
    if label in PROFILE_LABELS:
        return ["profile_left", "profile_right"]
    side, deg = label.split("_")
    order = ["25", "45", "65"]
    i = order.index(deg)
    near = [f"{side}_{order[j]}" for j in sorted(range(len(order)), key=lambda j: abs(j - i))]
    return [label] + [n for n in near if n != label] + (["profile_" + side] if deg == "65" else []) + ["front"]


def references_for(gallery: dict, label: str) -> list:
    bins = gallery.get("bins") or {}
    if label in PROFILE_LABELS:
        refs = []
        for l in ("profile_left", "profile_right"):
            refs.extend(bins.get(l) or [])
        return refs
    for l in _neighbors(label):
        if bins.get(l):
            return bins[l]
    return []


def threshold_for(label: str) -> float:
    if label in PROFILE_LABELS or label == "profile":
        return settings.FACE_PROFILE_MATCH_THRESHOLD
    if label == "front":
        return settings.FACE_MATCH_THRESHOLD
    return settings.FACE_SIDE_MATCH_THRESHOLD


@dataclass
class VerifyResult:
    ok: bool
    failed_views: list[str]
    message: str


def verify_scan(gallery: dict, bins: dict) -> VerifyResult:
    scores = {}
    for label, embs in bins.items():
        refs = references_for(gallery, label)
        if not refs:
            continue
        scores[label] = _best(refs, embs)
    logger.info("face login scores %s", {k: round(v, 3) for k, v in scores.items()})
    if "front" not in scores:
        return VerifyResult(False, ["front"], "Your straight-ahead view could not be matched.")
    if len(scores) < 2:
        return VerifyResult(False, list(bins), "Not enough angles could be compared with your registered scan.")
    failed = [l for l, s in scores.items() if s < threshold_for(l)]
    hard = [l for l, s in scores.items() if s < settings.FACE_SCAN_HARD_FLOOR]
    passed_ratio = (len(scores) - len(failed)) / len(scores)
    ok = (
        scores["front"] >= threshold_for("front")
        and not hard
        and passed_ratio >= settings.FACE_SCAN_MIN_PASS_RATIO
    )
    if ok:
        return VerifyResult(True, [], "Face verified from all angles.")
    views = [LABEL_TEXT.get(l, l) for l in (failed or hard)]
    return VerifyResult(False, failed or hard, "Face did not match your registered scan for: " + ", ".join(views) + ".")


def match_embedding(reference, embedding, label: str = "front") -> tuple[float, float]:
    if is_gallery(reference):
        refs = references_for(reference, label)
        sim = _best(refs, [embedding]) if refs else -1.0
        return sim, threshold_for(label)
    return _cos(reference, embedding), settings.FACE_MATCH_THRESHOLD


@on_ai_worker
def compare_live(reference, frame_bgr, landmarks, yaw=None, aligned=None) -> tuple[float, float, str] | None:
    if aligned is not None:
        emb = face_identifier.embed_crop(aligned)
    else:
        emb = face_identifier.embed(frame_bgr, landmarks)
    if emb is None:
        return None
    label = "front"
    if is_gallery(reference):
        if yaw is None:
            yaw = analyzer.head_yaw(frame_bgr, landmarks)
        if yaw is not None:
            label = mesh_label(yaw)
    sim, thr = match_embedding(reference, emb, label)
    return sim, thr, label


@on_ai_worker
def compare_live_profile(reference, frame_bgr) -> tuple[float, float] | None:
    if not is_gallery(reference) or not profile_detector.ready:
        return None
    refs = references_for(reference, "profile_left")
    if not refs:
        return None
    prof = profile_detector.detect(_downscale(frame_bgr))
    if prof is None:
        return None
    crop, _ = prof
    ok, _reason = face_identifier.basic_quality(crop)
    if not ok:
        return None
    emb = face_identifier.embed_crop(cv2.resize(crop, (112, 112), interpolation=cv2.INTER_AREA))
    if emb is None:
        return None
    return _best(refs, [emb]), settings.FACE_PROFILE_MATCH_THRESHOLD