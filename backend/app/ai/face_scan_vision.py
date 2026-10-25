
from __future__ import annotations

import time

import numpy as np
import cv2

from app.ai.analyzer import analyzer
from app.ai.face_id import face_identifier
from app.ai.face_scan import Observation

MIN_FACE_WIDTH = 0.16   
EDGE_MARGIN = 0.0      

EXTRA_TILE_FRAC = 0.5
EXTRA_TILE_STRIDE = 0.25
EXTRA_MIN_SCORE = 0.75
EXTRA_MAIN_OVERLAP = 0.25 

def _extra_faces(frame_bgr, main_box) -> int:
    det = analyzer.face_det
    if det is None:
        return 0
    H, W = frame_bgr.shape[:2]
    tw, th = int(W * EXTRA_TILE_FRAC), int(H * EXTRA_TILE_FRAC)
    step_x, step_y = max(1, int(W * EXTRA_TILE_STRIDE)), max(1, int(H * EXTRA_TILE_STRIDE))
    xs = sorted(set(list(range(0, W - tw + 1, step_x)) + [W - tw]))
    ys = sorted(set(list(range(0, H - th + 1, step_y)) + [H - th]))
    mx0, my0, mx1, my1 = main_box
    main_area = max(1.0, (mx1 - mx0) * (my1 - my0))
    extras = []
    with analyzer._face_mesh_lock:
        for y0 in ys:
            for x0 in xs:
                tile = np.ascontiguousarray(cv2.cvtColor(frame_bgr[y0:y0 + th, x0:x0 + tw], cv2.COLOR_BGR2RGB))
                for d in det.process(tile).detections or []:
                    if float(d.score[0]) < EXTRA_MIN_SCORE:
                        continue
                    b = d.location_data.relative_bounding_box
                    bx0, by0 = x0 + b.xmin * tw, y0 + b.ymin * th
                    bx1, by1 = bx0 + b.width * tw, by0 + b.height * th
                    area = max(1.0, (bx1 - bx0) * (by1 - by0))
                    ix = max(0.0, min(bx1, mx1) - max(bx0, mx0))
                    iy = max(0.0, min(by1, my1) - max(by0, my0))
                    if ix * iy / min(area, main_area) > EXTRA_MAIN_OVERLAP:
                        continue                      # that is the main face
                    extras.append((bx0, by0, bx1, by1))
    kept = []
    for e in extras:
        a = max(1.0, (e[2] - e[0]) * (e[3] - e[1]))
        for k in kept:
            ix = max(0.0, min(e[2], k[2]) - max(e[0], k[0]))
            iy = max(0.0, min(e[3], k[3]) - max(e[1], k[1]))
            if ix * iy / min(a, max(1.0, (k[2] - k[0]) * (k[3] - k[1]))) > 0.3:
                break
        else:
            kept.append(e)
    return len(kept)


def models_ready() -> bool:
    return bool(analyzer.ready and face_identifier.ready)


def observe_frame(frame_bgr, jpeg_b64: str | None = None, t: float | None = None) -> Observation:
    t = time.monotonic() if t is None else t
    h, w = frame_bgr.shape[:2]
    rgb = np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB), dtype=np.uint8)

    with analyzer._face_mesh_lock:
        res = analyzer.face_mesh.process(rgb)
    faces = analyzer._filter_faces(res.multi_face_landmarks or [])
    n = len(faces)

    if n == 0:
        return Observation(t=t, face_count=analyzer._count_faces(frame_bgr))
    if n >= 2:
        return Observation(t=t, face_count=n)

    lm = faces[0].landmark
    xs = np.array([p.x for p in lm])
    ys = np.array([p.y for p in lm])
    width = float(xs.max() - xs.min())

    extra = _extra_faces(frame_bgr, (float(xs.min()) * w, float(ys.min()) * h,
                                     float(xs.max()) * w, float(ys.max()) * h))
    if extra:
        return Observation(t=t, face_count=1 + extra)

    quality = ""
    if xs.min() < -EDGE_MARGIN or xs.max() > 1 + EDGE_MARGIN or ys.min() < -EDGE_MARGIN or ys.max() > 1 + EDGE_MARGIN:
        quality = "face_cut_off"
    elif width < MIN_FACE_WIDTH:
        quality = "face_too_small"

    yaw_raw, pitch_raw = analyzer._head_pose(lm, w, h)
    if yaw_raw is None or pitch_raw is None:
        return Observation(t=t, face_count=1, quality_reason=quality or "face_not_aligned")
    yaw, pitch = -float(yaw_raw), -float(pitch_raw)

    ok, aligned, reason = face_identifier.face_visibility_quality(frame_bgr, lm)
    quality = quality or ("" if ok else reason)

    emb = face_identifier.embed(frame_bgr, lm)
    if emb is None:
        return Observation(t=t, face_count=1, yaw=yaw, pitch=pitch, quality_reason=quality or "face_not_aligned")

    sharp = 0.0
    if aligned is not None:
        sharp = float(cv2.Laplacian(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())

    return Observation(t=t, face_count=1, yaw=yaw, pitch=pitch, embedding=emb,
                       quality_reason=quality, jpeg_b64=jpeg_b64, sharpness=sharp)
