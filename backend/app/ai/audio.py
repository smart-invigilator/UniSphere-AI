"""Simple voice-activity detection for the realtime audio stream.

The browser sends a normalized RMS loudness value rather than raw audio. This
detector treats sustained loudness as speech-like activity. It does not do
speech recognition, transcription, or speaker separation.
"""
from __future__ import annotations

import time


class AudioAnalyzer:
    """Detect sustained voice-like sound from normalized RMS levels."""

    def __init__(self, threshold: float = 0.02, streak_seconds: float = 2.0,
                 cooldown_seconds: float = 20.0):
        self.threshold = threshold
        self.streak_seconds = streak_seconds
        self.cooldown_seconds = cooldown_seconds

    def analyze(self, level: float, state, now: float | None = None) -> dict | None:
        """Return a talking alert when sound remains above the threshold.

        ``state`` is the live student's existing state object. It must provide
        ``audio_streak_start`` and ``last_talking_alert`` attributes.
        """
        try:
            level = max(0.0, min(1.0, float(level or 0)))
        except (TypeError, ValueError):
            level = 0.0

        now = time.time() if now is None else now
        if level < self.threshold:
            state.audio_streak_start = None
            return None

        if state.audio_streak_start is None:
            state.audio_streak_start = now
            return None

        sustained = now - state.audio_streak_start >= self.streak_seconds
        cooled_down = now - state.last_talking_alert > self.cooldown_seconds
        if not (sustained and cooled_down):
            return None

        state.last_talking_alert = now
        return {
            "alert_type": "Talking Detected",
            "severity": "medium",
            "confidence": 0.7,
            "ts": now,
        }


audio_analyzer = AudioAnalyzer()