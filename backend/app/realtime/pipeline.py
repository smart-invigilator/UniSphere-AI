import asyncio
import logging
import time
from collections import deque

from app.core.config import settings
from app.ai.engine import engine
from app.ai.analyzer import analyzer
from app.ai.face_id import face_identifier
from app.ai import face_scan
from app.ai.utils import decode_b64_jpeg
from app.realtime.manager import manager
from app.realtime.db_writer import writer

logger = logging.getLogger(__name__)

IDENTITY_LOG_SAMPLE_EVERY = 4
FACE_OCCLUSION_ALERT_COOLDOWN_SECONDS = 20.0


def _identity_step(s, frame, landmarks, alerts: list, identity_logs: list) -> None:
    if not (s.reference_embedding and face_identifier.ready):
        return
    if landmarks is None:
        s.face_occlusion_streak = 0
        profile = None
        if face_scan.is_gallery(s.reference_embedding):
            profile = face_scan.compare_live_profile(s.reference_embedding, frame)
        if profile is not None:
            sim, threshold = profile
            s.face_missing_streak = 0
            s.last_similarity = round(sim, 3)
            if sim >= threshold:
                s.profile_mismatch_streak = 0
                s.mismatch_streak = 0
                s.identity_status = "verified"
            else:
                s.profile_mismatch_streak += 1
                if s.profile_mismatch_streak >= settings.FACE_PROFILE_MISMATCH_STREAK:
                    s.identity_status = "mismatch"
            s.identity_log_counter += 1
            profile_match = sim >= threshold
            if not profile_match or s.identity_log_counter % IDENTITY_LOG_SAMPLE_EVERY == 0:
                identity_logs.append((sim, profile_match))
            if s.profile_mismatch_streak == settings.FACE_PROFILE_MISMATCH_STREAK:
                alerts.append({
                    "alert_type": "Different Person Detected",
                    "severity": "high",
                    "confidence": round(max(0.0, 1.0 - sim), 3),
                    "ts": time.time(),
                })
        else:
            s.face_missing_streak += 1
            if s.face_missing_streak >= settings.FACE_MISSING_FRAMES_FOR_UNVERIFIED:
                s.identity_status = "no_face"
                s.last_similarity = None
        return

    s.face_missing_streak = 0
    s.profile_mismatch_streak = 0
    yaw = analyzer.head_yaw(frame, landmarks)
    if yaw is not None and abs(yaw) > settings.FACE_SCAN_FRONT_MAX_YAW + 8 and face_scan.is_gallery(s.reference_embedding):
        aligned = face_identifier.align(frame, landmarks)
        visible, reason = face_identifier.basic_quality(aligned)
    else:
        visible, aligned, reason = face_identifier.face_visibility_quality(frame, landmarks)
    if not visible:
        s.face_occlusion_streak += 1
        if s.face_occlusion_streak >= settings.FACE_QUALITY_STREAK_FRAMES:
            s.identity_status = "obstructed"
            s.last_similarity = None
            if time.time() - s.last_occlusion_alert > FACE_OCCLUSION_ALERT_COOLDOWN_SECONDS:
                alerts.append({
                    "alert_type": "Face Covered",
                    "severity": "high",
                    "confidence": 0.85,
                    "ts": time.time(),
                })
                s.last_occlusion_alert = time.time()
        return

    s.face_occlusion_streak = 0
    just_reappeared = s.identity_status in ("no_face", "obstructed", "verifying")
    if just_reappeared:
        s.identity_status = "verifying"
        s.last_similarity = None
    s.face_check_counter += 1
    due = just_reappeared or s.face_check_counter % settings.FACE_CHECK_EVERY == 0
    if not due:
        return
    compared = face_scan.compare_live(s.reference_embedding, frame, landmarks, yaw=yaw, aligned=aligned)
    if compared is None:
        return
    sim, threshold, _view = compared
    s.last_similarity = round(sim, 3)
    is_match = sim >= threshold
    if not is_match:
        s.mismatch_streak += 1
        s.identity_status = "mismatch"
    else:
        s.mismatch_streak = 0
        s.identity_status = "verified"
    s.identity_log_counter += 1
    if not is_match or s.identity_log_counter % IDENTITY_LOG_SAMPLE_EVERY == 0:
        identity_logs.append((sim, is_match))
    if s.mismatch_streak == settings.FACE_MISMATCH_STREAK:
        alerts.append({
            "alert_type": "Different Person Detected",
            "severity": "high",
            "confidence": round(max(0.0, 1.0 - sim), 3),
            "ts": time.time(),
        })


def process_frame_job(s, image_b64: str):
    frame = decode_b64_jpeg(image_b64)
    if frame is None:
        return None
    result = analyzer.analyze(frame, s.ai_state)
    alerts = list(result["alerts"])
    identity_logs: list = []
    _identity_step(s, frame, result.get("landmarks"), alerts, identity_logs)
    return result["metrics"], alerts, identity_logs


class FramePipeline:
    def __init__(self):
        self._emit_alert = None
        self._request_tick = None
        self._stopping = False
        self.analyzed = 0
        self.coalesced = 0
        self.failed = 0
        self.undecodable = 0
        self.oversized = 0
        self.stale_results = 0
        self._latencies: deque = deque(maxlen=2000)

    def bind(self, emit_alert, request_tick) -> None:
        self._emit_alert = emit_alert
        self._request_tick = request_tick

    def submit_webcam(self, s, image_b64: str) -> None:
        if self._stopping:
            return
        s.frame_counter += 1
        if s.frame_counter % max(1, settings.FRAME_SAMPLE_RATE) != 0:
            return
        if s.pending_frame is not None:
            s.frames_coalesced += 1
            self.coalesced += 1
        s.pending_frame = (image_b64, time.perf_counter())
        task = s.pipeline_task
        if task is None or task.done():
            s.pipeline_task = asyncio.create_task(self._drain(s), name=f"frames-{s.attempt_id}")

    async def _drain(self, s) -> None:
        while s.pending_frame is not None and not self._stopping:
            image_b64, received_at = s.pending_frame
            s.pending_frame = None
            try:
                out = await engine.run_async(process_frame_job, s, image_b64)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.failed += 1
                logger.exception("Frame analysis failed for attempt %s", s.attempt_id)
                continue
            if out is None:
                self.undecodable += 1
                continue
            if not manager.is_current(s):
                self.stale_results += 1
                return
            latency = time.perf_counter() - received_at
            self._latencies.append(latency)
            s.last_analysis_ms = round(latency * 1000, 1)
            self.analyzed += 1
            try:
                await self._apply(s, out, image_b64)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Applying analysis result failed for attempt %s", s.attempt_id)

    async def _apply(self, s, out, image_b64: str) -> None:
        metrics, alerts, identity_logs = out
        s.analysis_count += 1
        s.attention = metrics.get("attention", s.attention)
        s.last_metrics = metrics
        if s.analysis_count % 10 == 0:
            writer.attention(s.db_id, s.attempt_id, s.attention)
        for sim, is_match in identity_logs:
            writer.identity_log(s.attempt_id, sim, is_match)
        for a in alerts:
            s.alert_count += 1
            s.status = "alert"
            if self._emit_alert is not None:
                await self._emit_alert(s, a, image_b64)
        if not alerts and s.status == "alert":
            if (s.ai_state.away_frames == 0 and s.ai_state.missing_frames == 0
                    and s.mismatch_streak == 0 and s.face_occlusion_streak == 0
                    and metrics.get("faces", 1) <= 1 and not metrics.get("objects")):
                s.status = "normal"
        if self._request_tick is not None:
            self._request_tick(s.exam_id)

    def cancel_student(self, s) -> None:
        s.pending_frame = None
        task = s.pipeline_task
        if task is not None and not task.done():
            task.cancel()

    async def stop(self, students) -> None:
        self._stopping = True
        tasks = []
        for s in students:
            s.pending_frame = None
            if s.pipeline_task is not None and not s.pipeline_task.done():
                tasks.append(s.pipeline_task)
        if tasks:
            done, pending = await asyncio.wait(tasks, timeout=10)
            for t in pending:
                t.cancel()

    def latency_percentiles(self) -> dict:
        data = sorted(self._latencies)
        if not data:
            return {"p50_ms": None, "p95_ms": None, "max_ms": None}

        def pick(p):
            return round(data[min(len(data) - 1, int(p * len(data)))] * 1000, 1)
        return {"p50_ms": pick(0.5), "p95_ms": pick(0.95), "max_ms": round(data[-1] * 1000, 1)}

    def stats(self) -> dict:
        return {
            "analyzed": self.analyzed,
            "coalesced": self.coalesced,
            "failed": self.failed,
            "undecodable": self.undecodable,
            "oversized": self.oversized,
            "stale_results": self.stale_results,
            "analysis_latency": self.latency_percentiles(),
        }

    def debug_stats(self) -> dict:
        return {
            "latencies": list(self._latencies),
            "analyses": self.analyzed,
            "coalesced": self.coalesced,
            "engine": engine.stats(),
            "db_writer": writer.stats(),
        }


pipeline = FramePipeline()