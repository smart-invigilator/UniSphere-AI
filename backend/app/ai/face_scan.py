
from __future__ import annotations

import math
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

SECTOR_COUNT = 8
SECTOR_LABELS = [
    "Slowly turn your head to the RIGHT",
    "Look UP and to the RIGHT",
    "Tilt your head UP",
    "Look UP and to the LEFT",
    "Slowly turn your head to the LEFT",
    "Look DOWN and to the LEFT",
    "Tilt your head DOWN",
    "Look DOWN and to the RIGHT",
]
FRONT_START_LABEL = "Look straight at the camera and hold still"
FRONT_END_LABEL = "Now look straight at the camera again"

HARD_QUALITY = {"face_not_aligned", "face_low_texture", "face_low_sharpness", "face_too_small", "face_cut_off"}
SOFT_QUALITY = {"eyes_covered", "mouth_covered"}

QUALITY_MESSAGES = {
    "face_too_small": "Move a little closer to the camera.",
    "face_cut_off": "Keep your whole face inside the frame.",
    "face_low_texture": "Not enough light — face a window or lamp.",
    "face_low_sharpness": "The image is blurry — hold still and clean the camera.",
    "face_not_aligned": "Keep your face clearly visible.",
    "eyes_covered": "Your eyes must be visible — remove anything covering them.",
    "mouth_covered": "Your mouth/nose must be visible — remove masks or hands.",
}


@dataclass
class ScanConfig:
    yaw_target_deg: float = 22.0
    pitch_target_deg: float = 13.0
    sector_min_radius: float = 0.80
    sector_angle_tol_deg: float = 28.0
    front_max_abs_yaw: float = 16.0
    front_max_abs_pitch: float = 25.0
    front_stability_deg: float = 9.0
    front_return_radius: float = 0.45
    front_hold_frames: int = 4
    ring_hold_frames: int = 2
    front_end_hold_frames: int = 3
    consec_min_sim: float = 0.50
    anchor_sim_front: float = 0.50
    anchor_sim_side: float = 0.28
    front_min_sim: float = 0.45     
    legacy_min_sim: float = 0.38     
    sector_min_sim: float = 0.30
    max_sector_misses: int = 1
    enrolled_fail_streak: int = 4
    enrolled_fail_total: int = 8
    identity_strikes_to_restart: int = 2
    presence_grace_s: float = 1.2
    max_restarts: int = 3
    max_duration_s: float = 120.0
    step_timeout_s: float = 35.0
    min_total_time_s: float = 3.0
    min_frame_interval_s: float = 0.08
    max_frames: int = 700
    debug: bool = False

    @classmethod
    def from_settings(cls, s) -> "ScanConfig":
        return cls(
            yaw_target_deg=s.FACE_SCAN_YAW_TARGET_DEG,
            pitch_target_deg=s.FACE_SCAN_PITCH_TARGET_DEG,
            consec_min_sim=s.FACE_SCAN_CONSEC_MIN_SIM,
            anchor_sim_front=s.FACE_SCAN_ANCHOR_SIM_FRONT,
            anchor_sim_side=s.FACE_SCAN_ANCHOR_SIM_SIDE,
            front_min_sim=s.FACE_SCAN_FRONT_MIN_SIM,
            legacy_min_sim=s.FACE_SCAN_LEGACY_MIN_SIM,
            sector_min_sim=s.FACE_SCAN_SECTOR_MIN_SIM,
            max_sector_misses=s.FACE_SCAN_MAX_SECTOR_MISSES,
            max_restarts=s.FACE_SCAN_MAX_RESTARTS,
            max_duration_s=s.FACE_SCAN_MAX_SECONDS,
            debug=s.FACE_SCAN_DEBUG,
        )


@dataclass
class Observation:
    t: float                           
    face_count: int                     
    yaw: float | None = None          
    pitch: float | None = None       
    embedding: Any = None                
    quality_reason: str = ""             
    jpeg_b64: str | None = None        
    sharpness: float = 0.0


@dataclass
class ScanResult:
    templates: dict
    registration_embedding: list
    best_front_jpeg: str | None
    metrics: dict


def _unit(v) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32)
    return v / (np.linalg.norm(v) + 1e-8)


def cos(a, b) -> float:
    return float(np.dot(_unit(a), _unit(b)))


def _mean_unit(embs) -> np.ndarray:
    return _unit(np.mean(np.stack([_unit(e) for e in embs]), axis=0))


def _angdiff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


@dataclass
class Step:
    key: str
    kind: str              
    sector: int | None
    label: str
    hold: int

    def public(self) -> dict:
        return {"key": self.key, "kind": self.kind, "sector": self.sector, "label": self.label}


class FaceScanSession:

    def __init__(self, *, mode: str, cfg: ScanConfig | None = None, reference=None,
                 templates: dict | None = None, rng=None, now: float | None = None):
        if mode not in ("enroll", "upgrade", "verify"):
            raise ValueError("mode must be enroll | upgrade | verify")
        self.mode = mode
        self.cfg = cfg or ScanConfig()
        self.rng = rng or secrets.SystemRandom()
        self.reference = _unit(reference) if reference is not None else None
        self.enrolled_front = None
        self.enrolled_ring: dict[int, np.ndarray] = {}
        if mode == "verify":
            if not templates:
                raise ValueError("verify mode needs templates")
            self.enrolled_front = _unit(templates["front"]["embedding"])
            self.enrolled_ring = {int(r["sector"]): _unit(r["embedding"]) for r in templates["ring"]}
        if mode == "upgrade" and self.reference is None:
            raise ValueError("upgrade mode needs a reference embedding")

        self.t0 = now if now is not None else time.monotonic()
        self.phase = "running"           
        self.fail_reason = ""
        self.fail_message = ""
        self.restarts = 0
        self.frames = 0
        self.last_t: float | None = None
        self.result: ScanResult | None = None
        self.enrolled_fail_total_count = 0
        self.last_pose: tuple[float, float] | None = None
        self.last_face_count = 0
        self.steps: list[Step] = []
        self._reset_run(self.t0)


    def _new_steps(self) -> list[Step]:
        cfg = self.cfg
        direction = self.rng.choice([1, -1])
        start = self.rng.randrange(SECTOR_COUNT)
        order = [(start + direction * i) % SECTOR_COUNT for i in range(SECTOR_COUNT)]
        steps = [Step("front_start", "front", None, FRONT_START_LABEL, cfg.front_hold_frames)]
        steps += [Step(f"s{k}", "ring", k, SECTOR_LABELS[k], cfg.ring_hold_frames) for k in order]
        steps.append(Step("front_end", "front", None, FRONT_END_LABEL, cfg.front_end_hold_frames))
        return steps

    def _reset_run(self, now: float):
        self.steps = self._new_steps()
        self.step_idx = 0
        self.step_started = now
        self.hold: list[dict] = []
        self.anchor: np.ndarray | None = None
        self.baseline: tuple[float, float] | None = None
        self.prev_emb: np.ndarray | None = None
        self.strikes = 0
        self.enrolled_fail_streak_count = 0
        self.run_started = False
        self.last_good_t = now
        self.front_embs: list[np.ndarray] = []
        self.best_front: tuple[float, str | None] = (-1.0, None)
        self.ring_data: dict[int, dict] = {}
        self.run_started_at = now


    def _radius_angle(self, yaw: float, pitch: float) -> tuple[float, float, float, float]:
        by, bp = self.baseline if self.baseline else (0.0, 0.0)
        ux = (yaw - by) / self.cfg.yaw_target_deg
        uy = (pitch - bp) / self.cfg.pitch_target_deg
        return math.hypot(ux, uy), math.degrees(math.atan2(uy, ux)) % 360.0, ux, uy

    def _sector_hit(self, ux: float, uy: float, sector: int) -> bool:
        r = math.hypot(ux, uy)
        ang = math.degrees(math.atan2(uy, ux)) % 360.0
        return r >= self.cfg.sector_min_radius and _angdiff(ang, 45.0 * sector) <= self.cfg.sector_angle_tol_deg

    def _enrolled_sim(self, emb, step: Step) -> float | None:
        if self.mode == "verify":
            if step.kind == "front":
                return cos(emb, self.enrolled_front)
            k = step.sector
            near = [self.enrolled_ring[j % SECTOR_COUNT] for j in (k - 1, k, k + 1)
                    if (j % SECTOR_COUNT) in self.enrolled_ring]
            return max(cos(emb, t) for t in near) if near else None
        if self.mode == "upgrade" and step.kind == "front":
            return cos(emb, self.reference)
        return None

    def _public(self, code: str, message: str, pose=None) -> dict:
        step = self.steps[min(self.step_idx, len(self.steps) - 1)]
        done_sectors = [s.sector for s in self.steps[:self.step_idx] if s.kind == "ring"]
        left = max(0, int(self.cfg.max_duration_s - ((self.last_t or self.t0) - self.t0)))
        return {
            "status": self.phase,
            "code": code,
            "message": message,
            "steps": [s.public() for s in self.steps],
            "step_index": self.step_idx,
            "target_sector": step.sector if step.kind == "ring" else None,
            "completed_sectors": done_sectors,
            "hold": {"have": len(self.hold), "need": step.hold},
            "pose": {"x": round(pose[0], 3), "y": round(pose[1], 3)} if pose else None,
            "face_count": self.last_face_count,
            "restarts": self.restarts,
            "max_restarts": self.cfg.max_restarts,
            "seconds_left": left,
        }

    def _fail(self, reason: str, message: str) -> dict:
        self.phase = "failed"
        self.fail_reason = reason
        self.fail_message = message
        return self._public(reason, message)

    def _restart(self, reason: str, message: str, now: float) -> dict:
        self.restarts += 1
        if self.restarts > self.cfg.max_restarts:
            return self._fail("too_many_violations",
                              "The scan was stopped because it was interrupted too many times. Please try again.")
        self._reset_run(now)
        res = self._public("restart_" + reason, message + " The scan restarts from the beginning.")
        res["restarted"] = True
        return res

    def snapshot(self, code: str = "ready", message: str = "Look at the camera to begin.") -> dict:
        """Current state without feeding a frame (used when a session is created)."""
        return self._public(code, message)


    def process(self, obs: Observation) -> dict:
        cfg = self.cfg
        if self.phase != "running":
            return self._public(self.fail_reason or "done", self.fail_message or "Scan finished.")
        now = obs.t
        if self.last_t is not None and now - self.last_t < cfg.min_frame_interval_s:
            return self._public("too_fast", "Please hold on…", self.last_pose)
        self.last_t = now
        self.frames += 1
        self.last_face_count = obs.face_count
        if self.frames > cfg.max_frames:
            return self._fail("too_many_frames", "The scan took too long. Please try again.")
        if now - self.t0 > cfg.max_duration_s:
            return self._fail("timeout", "The scan took too long. Please try again.")
        if now - self.step_started > cfg.step_timeout_s:
            return self._fail("timeout", "You didn't reach the highlighted direction in time. Please try again.")

        step = self.steps[self.step_idx]

        if obs.face_count >= 2:
            self.hold = []
            if self.run_started:
                return self._restart("multiple_faces", "More than one face was detected.", now)
            return self._public("multiple_faces", "Only ONE face may be visible. Ask others to step out of view.")

        usable = (obs.face_count == 1 and obs.yaw is not None and obs.pitch is not None
                  and obs.embedding is not None)
        qreason = obs.quality_reason if usable else ""
        bad_quality = usable and (qreason in HARD_QUALITY or (qreason in SOFT_QUALITY and step.kind == "front"))
        if not usable or bad_quality:
            self.hold = []
            if self.run_started and now - self.last_good_t > cfg.presence_grace_s:
                return self._restart("face_lost", "Your face left the camera view.", now)
            if not usable:
                return self._public("no_face", "We can't see your face. Look at the camera.", self.last_pose)
            return self._public("quality", QUALITY_MESSAGES.get(qreason, "Keep your face clearly visible."),
                                self.last_pose)

        yaw, pitch, emb = float(obs.yaw), float(obs.pitch), _unit(obs.embedding)

        id_bad = None
        if self.prev_emb is not None and cos(emb, self.prev_emb) < cfg.consec_min_sim:
            id_bad = "chain"
        if id_bad is None and self.anchor is not None:
            r, _, _, _ = self._radius_angle(yaw, pitch)
            frac = min(r, 1.0)
            thr = cfg.anchor_sim_front + (cfg.anchor_sim_side - cfg.anchor_sim_front) * frac
            if cos(emb, self.anchor) < thr:
                id_bad = "anchor"
        if id_bad:
            self.hold = []
            self.strikes += 1
            if cfg.debug:
                print(f"[FaceScan] identity strike ({id_bad}) #{self.strikes}")
            if self.strikes >= cfg.identity_strikes_to_restart:
                return self._restart("identity_changed", "The face changed during the scan.", now)
            return self._public("identity_check", "Hold still — checking it is really you.", self.last_pose)
        self.strikes = 0

        sim_enrolled = self._enrolled_sim(emb, step)
        if sim_enrolled is not None and step.kind == "front":
            need = cfg.front_min_sim if self.mode == "verify" else cfg.legacy_min_sim
            if sim_enrolled < need:
                self.hold = []
                self.enrolled_fail_streak_count += 1
                self.enrolled_fail_total_count += 1
                if cfg.debug:
                    print(f"[FaceScan] enrolled mismatch {sim_enrolled:.3f} < {need}")
                if (self.enrolled_fail_streak_count >= cfg.enrolled_fail_streak
                        or self.enrolled_fail_total_count >= cfg.enrolled_fail_total):
                    return self._fail("identity_mismatch",
                                      "We couldn't verify that you are the registered student.")
                return self._public("identity_check", "Hold still — verifying your face.", self.last_pose)
            self.enrolled_fail_streak_count = 0

        self.prev_emb = emb
        self.last_good_t = now
        self.run_started = True

        if step.kind == "front":
            return self._front_step(step, yaw, pitch, emb, obs, now)
        return self._ring_step(step, yaw, pitch, emb, sim_enrolled, now)


    def _front_step(self, step, yaw, pitch, emb, obs, now) -> dict:
        cfg = self.cfg
        if self.baseline is None:
            pose_ok = abs(yaw) <= cfg.front_max_abs_yaw and abs(pitch) <= cfg.front_max_abs_pitch
            ux, uy = yaw / cfg.yaw_target_deg, pitch / cfg.pitch_target_deg
        else:
            r, _, ux, uy = self._radius_angle(yaw, pitch)
            pose_ok = r <= cfg.front_return_radius
        self.last_pose = (ux, uy)
        if not pose_ok:
            self.hold = []
            return self._public("pose", "Look straight at the camera.", self.last_pose)

        self.hold.append({"yaw": yaw, "pitch": pitch, "emb": emb, "jpeg": obs.jpeg_b64, "sharp": obs.sharpness})
        if self.baseline is None and len(self.hold) > 1:
            ys = [h["yaw"] for h in self.hold]
            ps = [h["pitch"] for h in self.hold]
            if max(ys) - min(ys) > cfg.front_stability_deg or max(ps) - min(ps) > cfg.front_stability_deg:
                self.hold = self.hold[-1:]
                return self._public("hold", "Hold your head still.", self.last_pose)
        if len(self.hold) < step.hold:
            return self._public("hold", "Hold still…", self.last_pose)

        embs = [h["emb"] for h in self.hold]
        self.front_embs.extend(embs)
        for h in self.hold:
            if h["jpeg"] and h["sharp"] > self.best_front[0]:
                self.best_front = (h["sharp"], h["jpeg"])
        if step.key == "front_start":
            self.baseline = (float(np.median([h["yaw"] for h in self.hold])),
                             float(np.median([h["pitch"] for h in self.hold])))
            self.anchor = _mean_unit(embs)
        return self._advance(now)

    def _ring_step(self, step, yaw, pitch, emb, sim_enrolled, now) -> dict:
        cfg = self.cfg
        _, _, ux, uy = self._radius_angle(yaw, pitch)
        self.last_pose = (ux, uy)
        if not self._sector_hit(ux, uy, step.sector):
            self.hold = []
            return self._public("seek", step.label, self.last_pose)
        self.hold.append({"emb": emb, "ux": ux, "uy": uy, "sim": sim_enrolled})
        if len(self.hold) < step.hold:
            return self._public("hold", "Good — hold it…", self.last_pose)
        sims = [h["sim"] for h in self.hold if h["sim"] is not None]
        self.ring_data[step.sector] = {
            "embedding": _mean_unit([h["emb"] for h in self.hold]),
            "ux": float(np.mean([h["ux"] for h in self.hold])),
            "uy": float(np.mean([h["uy"] for h in self.hold])),
            "sim": max(sims) if sims else None,
        }
        if cfg.debug and sims:
            print(f"[FaceScan] sector {step.sector} enrolled-sim {max(sims):.3f}")
        return self._advance(now)

    def _advance(self, now: float) -> dict:
        self.step_idx += 1
        self.hold = []
        self.step_started = now
        if self.step_idx >= len(self.steps):
            return self._finish(now)
        nxt = self.steps[self.step_idx]
        return self._public("step_done", nxt.label, self.last_pose)

    def _finish(self, now: float) -> dict:
        cfg = self.cfg
        self.step_idx = len(self.steps) - 1  
        if now - self.run_started_at < cfg.min_total_time_s:
            return self._fail("too_fast", "The scan finished unnaturally fast. Please try again slowly.")
        misses = 0
        sector_sims: dict[int, float | None] = {}
        if self.mode == "verify":
            for k in range(SECTOR_COUNT):
                s = self.ring_data[k]["sim"]
                sector_sims[k] = s
                if s is None or s < cfg.sector_min_sim:
                    misses += 1
            if misses > cfg.max_sector_misses:
                return self._fail("identity_mismatch", "We couldn't verify that you are the registered student.")

        reg_emb = _mean_unit(self.front_embs)
        templates = {
            "version": 1,
            "baseline": {"yaw": round(self.baseline[0], 2), "pitch": round(self.baseline[1], 2)},
            "front": {"embedding": [round(float(x), 5) for x in reg_emb]},
            "ring": [
                {"sector": k, "ux": round(d["ux"], 3), "uy": round(d["uy"], 3),
                 "embedding": [round(float(x), 5) for x in d["embedding"]]}
                for k, d in sorted(self.ring_data.items())
            ],
        }
        self.phase = "passed"
        self.result = ScanResult(
            templates=templates,
            registration_embedding=[float(x) for x in reg_emb],
            best_front_jpeg=self.best_front[1],
            metrics={"restarts": self.restarts, "frames": self.frames, "sector_misses": misses,
                     "duration_s": round(now - self.t0, 1)},
        )
        return self._public("passed", "360° scan complete.", self.last_pose)



@dataclass
class ScanRecord:
    id: str
    purpose: str           
    engine: FaceScanSession
    user_id: int | None = None
    created: float = field(default_factory=time.monotonic)
    touched: float = field(default_factory=time.monotonic)
    consumed: bool = False
    failure_counted: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


class ScanStore:
    IDLE_TTL = 180.0
    DONE_TTL = 900.0

    def __init__(self, max_sessions: int = 300):
        self._items: dict[str, ScanRecord] = {}
        self._lock = threading.Lock()
        self.max_sessions = max_sessions
        self._failures: dict[int, list[float]] = {}

    def _purge(self, now: float):
        dead = []
        for sid, rec in self._items.items():
            ttl = self.DONE_TTL if rec.engine.phase == "passed" else self.IDLE_TTL
            if rec.consumed or now - rec.touched > ttl:
                dead.append(sid)
        for sid in dead:
            self._items.pop(sid, None)

    def create(self, purpose: str, engine: FaceScanSession, user_id: int | None = None) -> ScanRecord | None:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            if len(self._items) >= self.max_sessions:
                return None
            rec = ScanRecord(id=secrets.token_urlsafe(24), purpose=purpose, engine=engine, user_id=user_id)
            self._items[rec.id] = rec
            return rec

    def get(self, sid: str) -> ScanRecord | None:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            rec = self._items.get(sid)
            if rec:
                rec.touched = now
            return rec

    def consume(self, sid: str, purpose: str) -> ScanRecord | None:
        """One-time use of a PASSED session."""
        with self._lock:
            rec = self._items.get(sid)
            if (not rec or rec.consumed or rec.purpose != purpose or rec.engine.phase != "passed"):
                return None
            rec.consumed = True
            self._items.pop(sid, None)
            return rec

    def record_failure(self, user_id: int):
        now = time.monotonic()
        with self._lock:
            self._failures.setdefault(user_id, []).append(now)

    def locked_for(self, user_id: int, max_failures: int, window_s: float) -> float:
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._failures.get(user_id, []) if now - t < window_s]
            self._failures[user_id] = hits
            if len(hits) >= max_failures:
                return max(0.0, window_s - (now - hits[0]))
            return 0.0

    def clear_failures(self, user_id: int):
        with self._lock:
            self._failures.pop(user_id, None)
