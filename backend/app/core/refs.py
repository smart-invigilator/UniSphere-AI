"""Opaque public references for database ids.

Courses, exams and attempts are never exposed to clients by their sequential
integer primary key. The API hands out a short random-looking string instead
(for example ``Qk3v...``) and only accepts that string back.

The reference is deterministic (the same id always maps to the same string, so
the frontend can compare them) and tamper-proof: the id is encrypted with a
keystream derived from SECRET_KEY, and an authentication tag is embedded, so a
string that was not issued by this server cannot be forged or incremented.
It is scoped by kind, so an exam reference is useless as a course reference.

No database column is needed.
"""
import base64
import hashlib
import hmac
from typing import Annotated

from pydantic import BeforeValidator, PlainSerializer

from app.core.config import settings

COURSE, EXAM, ATTEMPT = "course", "exam", "attempt"


def _key() -> bytes:
    return hashlib.sha256(("refs-v1|" + settings.SECRET_KEY).encode()).digest()


def _mac(label: str, kind: str, data: bytes, n: int) -> bytes:
    return hmac.new(_key(), f"{label}|{kind}|".encode() + data, hashlib.sha256).digest()[:n]


def encode_ref(kind: str, value: int) -> str:
    pt = int(value).to_bytes(8, "big")
    iv = _mac("iv", kind, pt, 8)
    mask = _mac("enc", kind, iv, 8)
    ct = bytes(a ^ b for a, b in zip(pt, mask))
    return base64.urlsafe_b64encode(iv + ct).rstrip(b"=").decode()


def decode_ref(kind: str, ref) -> int:
    """Return the database id for a reference, or raise ValueError."""
    if not isinstance(ref, str) or not 16 <= len(ref) <= 32:
        raise ValueError("Invalid identifier")
    try:
        raw = base64.urlsafe_b64decode(ref + "=" * (-len(ref) % 4))
    except Exception:
        raise ValueError("Invalid identifier")
    if len(raw) != 16:
        raise ValueError("Invalid identifier")
    iv, ct = raw[:8], raw[8:]
    mask = _mac("enc", kind, iv, 8)
    pt = bytes(a ^ b for a, b in zip(ct, mask))
    if not hmac.compare_digest(iv, _mac("iv", kind, pt, 8)):
        raise ValueError("Invalid identifier")
    return int.from_bytes(pt, "big")


def _in(kind: str):
    return Annotated[int, BeforeValidator(lambda v: decode_ref(kind, v))]


def _out(kind: str):
    return Annotated[int, PlainSerializer(lambda v: encode_ref(kind, v), return_type=str, when_used="json")]


# Incoming (path / query / request body): reference string -> int id.
CourseIn, ExamIn, AttemptIn = _in(COURSE), _in(EXAM), _in(ATTEMPT)
# Outgoing (response bodies): int id -> reference string.
CourseOut_, ExamOut_, AttemptOut_ = _out(COURSE), _out(EXAM), _out(ATTEMPT)
