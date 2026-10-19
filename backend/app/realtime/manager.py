
import time
from threading import Lock
from app.ai.analyzer import StudentState


class LiveStudent:
    def __init__(self, attempt_id: int, exam_id: int, student_id: str, name: str,
                 db_id: int, department: str, reference_embedding=None):
        self.attempt_id = attempt_id
        self.exam_id = exam_id
        self.student_id = student_id 
        self.name = name
        self.db_id = db_id           
        self.department = department
        self.sid = None              
        self.connected = False
        self.status = "normal"
        self.attention = 100
        self.alert_count = 0
        self.last_activity = time.time()
        self.ai_state = StudentState()
        self.last_metrics = {}
        self.reference_embedding = reference_embedding
        self.face_check_counter = 0
        self.mismatch_streak = 0
        self.last_similarity = None
        self.identity_status = "verified" if reference_embedding else "unavailable"

        self.last_client_violation: dict[str, float] = {}

        self.audio_level: float = 0.0
        self.audio_streak_start: float | None = None
        self.last_talking_alert: float = 0.0

        self.identity_log_counter: int = 0

        self.face_occlusion_streak: int = 0
        self.last_occlusion_alert: float = 0.0
        self.face_missing_streak: int = 0

    def to_dict(self):
        return {
            "id": self.student_id,
            "db_id": self.db_id,
            "attemptId": self.attempt_id,
            "examId": self.exam_id,
            "name": self.name,
            "department": self.department,
            "connected": self.connected,
            "status": self.status if self.connected else "offline",
            "attention": self.attention,
            "alertCount": self.alert_count,
            "lastActivity": int(self.last_activity * 1000),
            "metrics": self.last_metrics,
            "identity": {
                "status": self.identity_status,
                "similarity": self.last_similarity,
            },
            "audioLevel": self.audio_level,
        }


class ConnectionManager:

    def __init__(self):
        self._students: dict[int, LiveStudent] = {}   
        self._sid_index: dict[str, int] = {}          
        self._lock = Lock()

    def register(self, attempt_id, exam_id, student_id, name, db_id, department,
                 reference_embedding=None) -> LiveStudent:
        with self._lock:
            existing = self._students.get(attempt_id)
            if existing:
                if reference_embedding is not None:
                    existing.reference_embedding = reference_embedding
                    existing.identity_status = "verified"
                existing.connected = True
                existing.status = "normal"
                existing.last_activity = time.time()
                return existing
            s = LiveStudent(attempt_id, exam_id, student_id, name, db_id, department, reference_embedding)
            self._students[attempt_id] = s
            return s

    def connect(self, attempt_id, sid):
        with self._lock:
            s = self._students.get(attempt_id)
            if s:
                s.sid = sid
                s.connected = True
                s.last_activity = time.time()
                self._sid_index[sid] = attempt_id
            return s

    def disconnect(self, sid):
        with self._lock:
            attempt_id = self._sid_index.pop(sid, None)
            if attempt_id is not None and attempt_id in self._students:
                s = self._students[attempt_id]
                s.connected = False
                s.status = "offline"
                return s
            return None

    def by_sid(self, sid) -> "LiveStudent | None":
        with self._lock:
            attempt_id = self._sid_index.get(sid)
            return self._students.get(attempt_id) if attempt_id is not None else None

    def by_attempt(self, attempt_id) -> "LiveStudent | None":
        with self._lock:
            return self._students.get(attempt_id)

    def snapshot(self, exam_id=None):
        with self._lock:
            vals = self._students.values()
            if exam_id is not None:
                vals = [s for s in vals if s.exam_id == exam_id]
            return [s.to_dict() for s in vals]


manager = ConnectionManager()