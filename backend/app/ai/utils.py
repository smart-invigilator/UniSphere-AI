"""Small shared helpers for the AI layer (frame decoding)."""
import base64

try:
    import numpy as np
    import cv2
    _CV_OK = True
except Exception:  # pragma: no cover
    np = None
    _CV_OK = False


def decode_b64_jpeg(b64: str):
    """Decode a base64 (optionally data-URL prefixed) JPEG/PNG into a BGR
    numpy array, or None on failure / if OpenCV isn't available."""
    if not _CV_OK or not b64:
        return None
    try:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        buf = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    except Exception:
        return None
