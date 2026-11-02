import time
from collections import OrderedDict
from threading import Lock
from fastapi import HTTPException, Request


class TokenBucketLimiter:
    def __init__(self, rate_per_second: float, burst: int, max_keys: int = 50000):
        self.rate = float(rate_per_second)
        self.burst = float(burst)
        self.max_keys = max_keys
        self._buckets: "OrderedDict[str, tuple[float, float]]" = OrderedDict()
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            tokens, last = self._buckets.pop(key, (self.burst, now))
            tokens = min(self.burst, tokens + (now - last) * self.rate)
            allowed = tokens >= 1.0
            if allowed:
                tokens -= 1.0
            self._buckets[key] = (tokens, now)
            while len(self._buckets) > self.max_keys:
                self._buckets.popitem(last=False)
            return allowed

    def check(self, request: Request, scope: str = "") -> None:
        client = request.client.host if request.client else "unknown"
        if not self.allow(f"{scope}:{client}"):
            raise HTTPException(429, "Too many requests — slow down and try again.")