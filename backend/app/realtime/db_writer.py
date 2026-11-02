import asyncio
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.identity_log import IdentityCheckLog
from app.models.monitoring import AttentionScore

logger = logging.getLogger(__name__)

_STOP = object()


class BackgroundWriter:
    def __init__(self):
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None
        self.written = 0
        self.failed = 0
        self.dropped = 0

    def start(self) -> None:
        if self._task is not None:
            return
        self._queue = asyncio.Queue(maxsize=settings.DB_WRITE_QUEUE_MAX)
        self._task = asyncio.create_task(self._run(), name="db-writer")

    def _put(self, row) -> None:
        if self._queue is None:
            self._write_now([row])
            return
        try:
            self._queue.put_nowait(row)
        except asyncio.QueueFull:
            self.dropped += 1
            logger.warning("DB write queue full; dropping a monitoring sample (%s total dropped)", self.dropped)

    def identity_log(self, attempt_id: int, similarity: float, is_match: bool) -> None:
        self._put(IdentityCheckLog(
            attempt_id=attempt_id, similarity=float(similarity), is_match=bool(is_match),
            timestamp=datetime.now(timezone.utc),
        ))

    def attention(self, student_db_id: int, attempt_id: int, score: float) -> None:
        self._put(AttentionScore(
            student_id=student_db_id, attempt_id=attempt_id, score=float(score),
            timestamp=datetime.now(timezone.utc),
        ))

    async def _run(self) -> None:
        queue = self._queue
        window = settings.DB_WRITE_BATCH_MS / 1000.0
        stopping = False
        while not stopping:
            item = await queue.get()
            if item is _STOP:
                break
            batch = [item]
            deadline = asyncio.get_running_loop().time() + window
            while len(batch) < settings.DB_WRITE_BATCH_MAX:
                timeout = deadline - asyncio.get_running_loop().time()
                if timeout <= 0:
                    break
                try:
                    nxt = await asyncio.wait_for(queue.get(), timeout)
                except asyncio.TimeoutError:
                    break
                if nxt is _STOP:
                    stopping = True
                    break
                batch.append(nxt)
            await asyncio.to_thread(self._write_now, batch)
        rest = []
        while not queue.empty():
            nxt = queue.get_nowait()
            if nxt is not _STOP:
                rest.append(nxt)
        if rest:
            await asyncio.to_thread(self._write_now, rest)

    def _write_now(self, rows: list) -> None:
        db = SessionLocal()
        try:
            db.add_all(rows)
            db.commit()
            self.written += len(rows)
        except Exception:
            db.rollback()
            logger.exception("Batched monitoring write failed; retrying rows individually")
            for row in rows:
                retry = SessionLocal()
                try:
                    retry.merge(row)
                    retry.commit()
                    self.written += 1
                except Exception:
                    retry.rollback()
                    self.failed += 1
                finally:
                    retry.close()
        finally:
            db.close()

    async def stop(self) -> None:
        if self._task is None:
            return
        try:
            self._queue.put_nowait(_STOP)
        except asyncio.QueueFull:
            await self._queue.put(_STOP)
        try:
            await asyncio.wait_for(self._task, timeout=15)
        except asyncio.TimeoutError:
            logger.error("DB writer did not finish flushing within 15s")
            self._task.cancel()
        self._task = None
        self._queue = None

    def stats(self) -> dict:
        return {
            "queued": self._queue.qsize() if self._queue else 0,
            "written": self.written,
            "failed": self.failed,
            "dropped": self.dropped,
        }


writer = BackgroundWriter()


def persist_alert_sync(student_db_id: int, attempt_id: int, student_code: str, student_name: str,
                       alert: dict, screenshot: str | None = None) -> dict:
    from app.models.alert import Alert
    db = SessionLocal()
    try:
        row = Alert(
            student_id=student_db_id, attempt_id=attempt_id, alert_type=alert["alert_type"],
            severity=alert["severity"], confidence=alert["confidence"], screenshot=screenshot,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "id": f"ALT-{row.id:06d}", "studentId": student_code,
            "studentName": student_name, "type": alert["alert_type"],
            "severity": alert["severity"], "confidence": alert["confidence"],
            "timestamp": int(row.timestamp.timestamp() * 1000),
            "reviewed": False, "notes": "",
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def persist_alert(s, alert: dict, screenshot: str | None = None) -> dict:
    return await asyncio.to_thread(
        persist_alert_sync, s.db_id, s.attempt_id, s.student_id, s.name, alert, screenshot,
    )