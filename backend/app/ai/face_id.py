from __future__ import annotations
import os

try:
    import numpy as np
    import cv2
    _CV_OK = True
except Exception:  
    np = None
    _CV_OK = False

from app.core.config import settings

MP_LEFT_EYE = [33, 133]
MP_RIGHT_EYE = [263, 362]
MP_NOSE = 1
MP_MOUTH_LEFT = 61
MP_MOUTH_RIGHT = 291

_ARCFACE_TEMPLATE = None
if _CV_OK:
    _ARCFACE_TEMPLATE = np.array([
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ], dtype=np.float32)


def landmarks_to_5pt(lm, w: int, h: int):
    def pt(idx):
        return np.array([lm[idx].x * w, lm[idx].y * h], dtype=np.float32)

    left_eye = (pt(MP_LEFT_EYE[0]) + pt(MP_LEFT_EYE[1])) / 2.0
    right_eye = (pt(MP_RIGHT_EYE[0]) + pt(MP_RIGHT_EYE[1])) / 2.0
    nose = pt(MP_NOSE)
    mouth_left = pt(MP_MOUTH_LEFT)
    mouth_right = pt(MP_MOUTH_RIGHT)
    return np.stack([left_eye, right_eye, nose, mouth_left, mouth_right])


class FaceIdentifier:
    def __init__(self):
        self.ready = False
        self.session = None
        self._input_name = None
        self._input_size = (112, 112)
        if _CV_OK and settings.ENABLE_FACE_ID:
            self._init_model()

    def _init_model(self):
        if not os.path.exists(settings.FACE_MODEL_PATH):
            print(f"[FaceID] Model not found at {settings.FACE_MODEL_PATH}; "
                  f"identity verification disabled (see README).")
            return
        try:
            from app.ai.engine import engine
            self.session, providers = engine.create_session(settings.FACE_MODEL_PATH)
            self._input_name = self.session.get_inputs()[0].name
            shape = self.session.get_inputs()[0].shape
            if len(shape) == 4 and isinstance(shape[2], int) and isinstance(shape[3], int):
                self._input_size = (shape[3], shape[2])  
            self.ready = True
            print(f"[FaceID] ArcFace model loaded providers={providers}")
        except Exception as e:
            print(f"[FaceID] Failed to load model: {e}")

    def align(self, frame_bgr, landmarks) -> "np.ndarray | None":
        h, w = frame_bgr.shape[:2]
        five_pt = landmarks_to_5pt(landmarks, w, h)
        M, _ = cv2.estimateAffinePartial2D(five_pt, _ARCFACE_TEMPLATE, method=cv2.LMEDS)
        if M is None:
            return None
        return cv2.warpAffine(frame_bgr, M, self._input_size, borderValue=0.0)

    def face_visibility_quality(self, frame_bgr, landmarks) -> "tuple[bool, np.ndarray | None, str]":
        """Check that the face is genuinely visible BEFORE trusting any
        embedding/similarity computed from it.

        MediaPipe returns a full landmark set even for a partially covered
        face (it extrapolates hidden points), so landmark presence alone does
        not mean the face is visible. A hand or object over the face gives a
        crop that is still "textured" enough to pass a whole-crop std check,
        so this also checks the EYE band and MOUTH band of the aligned
        112x112 crop separately:

        * real eyes always contain very dark pixels (pupils, lashes, brows)
          next to brighter skin -> large p50 - p5 contrast and edges;
        * a hand/paper/sleeve over the eyes is comparatively uniform.

        Returns (is_visible, aligned_crop_or_None, reason_if_not_visible).
        """
        aligned = self.align(frame_bgr, landmarks)
        if aligned is None:
            return False, None, "face_not_aligned"
        gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
        H, W = gray.shape[:2]
        sy, sx = H / 112.0, W / 112.0

        std = float(gray.std())
        blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if std < settings.FACE_QUALITY_MIN_STD:
            return False, aligned, "face_low_texture"
        if blur_var < settings.FACE_QUALITY_MIN_SHARPNESS:
            return False, aligned, "face_low_sharpness"

        # ArcFace template: eyes at y~51, mouth corners at y~92.
        eye_band = gray[int(36 * sy):int(64 * sy), int(22 * sx):int(90 * sx)]
        mouth_band = gray[int(80 * sy):int(104 * sy), int(34 * sx):int(78 * sx)]

        def contrast(region):
            if region.size == 0:
                return 0.0
            p5, p50 = np.percentile(region, [5, 50])
            return float(p50 - p5)

        def edge_density(region):
            if region.size == 0:
                return 0.0
            edges = cv2.Canny(region, 30, 90)
            return float((edges > 0).mean())

        eye_c = contrast(eye_band)
        eye_e = edge_density(eye_band)
        mouth_c = contrast(mouth_band)
        mouth_e = edge_density(mouth_band)

        if eye_c < settings.FACE_EYE_MIN_CONTRAST or eye_e < settings.FACE_EYE_MIN_EDGES:
            return False, aligned, "eyes_covered"
        if mouth_c < settings.FACE_MOUTH_MIN_CONTRAST and mouth_e < settings.FACE_MOUTH_MIN_EDGES:
            return False, aligned, "mouth_covered"
        return True, aligned, ""

    def embed(self, frame_bgr, landmarks) -> "np.ndarray | None":
        if not self.ready:
            return None
        aligned = self.align(frame_bgr, landmarks)
        if aligned is None:
            return None
        return self.embed_crop(aligned)

    def embed_crop(self, crop_bgr) -> "np.ndarray | None":
        if not self.ready or crop_bgr is None or crop_bgr.size == 0:
            return None
        if (crop_bgr.shape[1], crop_bgr.shape[0]) != tuple(self._input_size):
            crop_bgr = cv2.resize(crop_bgr, tuple(self._input_size), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
        rgb = (rgb - 127.5) / 128.0
        blob = rgb.transpose(2, 0, 1)[None]
        out = self.session.run(None, {self._input_name: blob})[0][0]
        norm = np.linalg.norm(out) + 1e-8
        return out / norm

    @staticmethod
    def basic_quality(crop_bgr, sharpness_scale: float = 1.0) -> "tuple[bool, str]":
        if crop_bgr is None or crop_bgr.size == 0:
            return False, "face_not_aligned"
        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        mean = float(gray.mean())
        if mean < settings.CAMERA_COVERED_MEAN:
            return False, "too_dark"
        if float(gray.std()) < settings.FACE_QUALITY_MIN_STD:
            return False, "face_low_texture"
        if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < settings.FACE_QUALITY_MIN_SHARPNESS * sharpness_scale:
            return False, "face_low_sharpness"
        return True, ""

    @staticmethod
    def average_embedding(embeddings: list) -> "list[float] | None":
        if not embeddings:
            return None
        stacked = np.stack(embeddings)
        avg = stacked.mean(axis=0)
        avg = avg / (np.linalg.norm(avg) + 1e-8)
        return avg.tolist()

    @staticmethod
    def cosine_similarity(a, b) -> float:
        va = np.asarray(a, dtype=np.float32)
        vb = np.asarray(b, dtype=np.float32)
        denom = (np.linalg.norm(va) * np.linalg.norm(vb)) + 1e-8
        return float(np.dot(va, vb) / denom)

    def compare(self, reference: list, frame_bgr, landmarks) -> "float | None":
        emb = self.embed(frame_bgr, landmarks)
        if emb is None:
            return None
        return self.cosine_similarity(reference, emb)


# Singleton
face_identifier = FaceIdentifier()