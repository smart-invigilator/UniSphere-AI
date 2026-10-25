import math

import numpy as np

from app.ai.face_scan import Observation

DIM = 128
POSE_VEC = np.random.RandomState(999).randn(DIM)
POSE_VEC /= np.linalg.norm(POSE_VEC)
BASE = (2.0, 5.0)                   


def person(seed):
    v = np.random.RandomState(seed).randn(DIM)
    return v / np.linalg.norm(v)


A, B = person(1), person(2)


class Sim:

    def __init__(self, sess, who=A, seed=0, dt=0.25, t=1.0):
        self.s, self.who, self.dt, self.t = sess, who, dt, t
        self.rs = np.random.RandomState(seed)
        self.pose = list(BASE)
        self.log = []

    def embedding(self, who, yaw, pitch):
        r = math.hypot((yaw - BASE[0]) / 22.0, (pitch - BASE[1]) / 13.0)
        noise = self.rs.randn(DIM)
        noise = 0.45 * noise / np.linalg.norm(noise)
        e = who + 0.25 * min(r, 1.5) * POSE_VEC + noise
        return e / np.linalg.norm(e)

    def target(self):
        st = self.s.steps[min(self.s.step_idx, len(self.s.steps) - 1)]
        if st.kind == "front":
            return BASE
        th = math.radians(45 * st.sector)
        return (BASE[0] + 27 * math.cos(th), BASE[1] + 15 * math.sin(th))

    def send(self, faces=1, who=None, yaw=None, pitch=None, quality="", visible=True, follow=True):
        who = A if who is None and self.who is None else (who if who is not None else self.who)
        if follow:
            tgt = self.target()
            self.pose[0] += 0.6 * (tgt[0] - self.pose[0])
            self.pose[1] += 0.6 * (tgt[1] - self.pose[1])
        y = self.pose[0] if yaw is None else yaw
        p = self.pose[1] if pitch is None else pitch
        self.t += self.dt
        if visible:
            obs = Observation(t=self.t, face_count=faces, yaw=y + self.rs.randn() * 0.4,
                              pitch=p + self.rs.randn() * 0.4, embedding=self.embedding(who, y, p),
                              quality_reason=quality, jpeg_b64="JPEG", sharpness=50.0)
        else:
            obs = Observation(t=self.t, face_count=0)
        res = self.s.process(obs)
        self.log.append(res["code"])
        return res

    def run(self, max_frames=300, events=None):
        events = events or {}
        res = None
        for i in range(max_frames):
            ev = events.get(i, {})
            res = self.send(**ev)
            if res["status"] != "running":
                break
        return res
