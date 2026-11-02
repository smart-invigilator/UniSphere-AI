import asyncio
import functools
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings

logger = logging.getLogger(__name__)

PREFERRED_PROVIDERS = ("CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider")


def _auto_workers() -> int:
    cores = os.cpu_count() or 1
    if cores <= 2:
        return 1
    return max(2, min(8, cores // 2))


class AIEngine:
    def __init__(self):
        self.workers = settings.AI_WORKERS if settings.AI_WORKERS > 0 else _auto_workers()
        self._executor: ThreadPoolExecutor | None = None
        self._create_lock = threading.Lock()
        self._local = threading.local()
        self._stats_lock = threading.Lock()
        self._busy = 0
        self._completed = 0
        self._failed = 0
        self._total_seconds = 0.0
        self._closed = False

    def _mark_worker(self):
        self._local.is_worker = True

    def in_worker(self) -> bool:
        return getattr(self._local, "is_worker", False)

    def _ensure(self) -> ThreadPoolExecutor:
        if self._executor is None:
            with self._create_lock:
                if self._executor is None:
                    self._executor = ThreadPoolExecutor(
                        max_workers=self.workers,
                        thread_name_prefix="ai-worker",
                        initializer=self._mark_worker,
                    )
        return self._executor

    def intra_op_threads(self) -> int:
        if settings.AI_INTRA_OP_THREADS > 0:
            return settings.AI_INTRA_OP_THREADS
        return max(1, (os.cpu_count() or 1) // self.workers)

    def onnx_providers(self) -> list[str]:
        try:
            import onnxruntime as ort
            available = set(ort.get_available_providers())
        except Exception:
            return ["CPUExecutionProvider"]
        if settings.AI_ONNX_PROVIDERS.strip():
            wanted = [p.strip() for p in settings.AI_ONNX_PROVIDERS.split(",") if p.strip()]
        else:
            wanted = list(PREFERRED_PROVIDERS)
        chosen = [p for p in wanted if p in available]
        if "CPUExecutionProvider" not in chosen:
            chosen.append("CPUExecutionProvider")
        return chosen

    def session_options(self):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = self.intra_op_threads()
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return opts

    def create_session(self, model_path: str):
        import onnxruntime as ort
        providers = self.onnx_providers()
        opts = self.session_options()
        if "DmlExecutionProvider" in providers:
            opts.enable_mem_pattern = False
        session = ort.InferenceSession(model_path, sess_options=opts, providers=providers)
        return session, session.get_providers()

    def _timed(self, fn, args, kwargs):
        with self._stats_lock:
            self._busy += 1
        start = time.perf_counter()
        ok = False
        try:
            result = fn(*args, **kwargs)
            ok = True
            return result
        finally:
            elapsed = time.perf_counter() - start
            with self._stats_lock:
                self._busy -= 1
                self._total_seconds += elapsed
                if ok:
                    self._completed += 1
                else:
                    self._failed += 1

    def run(self, fn, *args, **kwargs):
        if self.in_worker():
            return fn(*args, **kwargs)
        if self._closed:
            raise RuntimeError("AI engine is shut down")
        return self._ensure().submit(self._timed, fn, args, kwargs).result()

    async def run_async(self, fn, *args, **kwargs):
        if self._closed:
            raise RuntimeError("AI engine is shut down")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._ensure(), self._timed, fn, args, kwargs)

    def warmup(self, init_fn) -> None:
        if self.workers <= 0:
            return
        barrier = threading.Barrier(self.workers, timeout=60)

        def _init():
            try:
                init_fn()
            finally:
                try:
                    barrier.wait()
                except threading.BrokenBarrierError:
                    pass

        executor = self._ensure()
        futures = [executor.submit(_init) for _ in range(self.workers)]
        for f in futures:
            try:
                f.result(timeout=120)
            except Exception as exc:
                logger.warning("AI worker warm-up failed: %s", exc)

    def stats(self) -> dict:
        with self._stats_lock:
            done = self._completed
            return {
                "workers": self.workers,
                "intra_op_threads": self.intra_op_threads(),
                "busy": self._busy,
                "completed": done,
                "failed": self._failed,
                "avg_ms": round(self._total_seconds / done * 1000, 1) if done else None,
            }

    def shutdown(self, wait: bool = True) -> None:
        self._closed = True
        executor = self._executor
        if executor is not None:
            executor.shutdown(wait=wait, cancel_futures=True)


engine = AIEngine()


def on_ai_worker(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return engine.run(fn, *args, **kwargs)
    return wrapper