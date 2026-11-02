import io
import os
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session as DBSession
from app.db.session import get_db
from app.api.deps import require_roles
from app.api.attempts import _own_attempt, _attempt_deadline
from app.core.config import settings
from app.models.user import User, Role
from app.models.exam import Question
from app.schemas.attempt import MediaUploadOut

router = APIRouter(prefix="/uploads", tags=["uploads"])

IMAGE_FORMATS = {"PNG": ("png", "image/png"), "JPEG": ("jpg", "image/jpeg"),
                 "GIF": ("gif", "image/gif"), "WEBP": ("webp", "image/webp")}
CHUNK = 1024 * 1024


def _read_limited(file: UploadFile, max_mb: int) -> bytes:
    limit = max_mb * 1024 * 1024
    buf = io.BytesIO()
    while True:
        chunk = file.file.read(CHUNK)
        if not chunk:
            break
        buf.write(chunk)
        if buf.tell() > limit:
            raise HTTPException(413, f"File is too large. Maximum size is {max_mb} MB.")
    data = buf.getvalue()
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    return data


def _sniff(data: bytes) -> tuple[str, str, str]:
    if data[:5] == b"%PDF-":
        return "pdf", "pdf", "application/pdf"
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            width, height = img.size
            img.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, "Unsupported or corrupted file. Upload a PNG, JPG, GIF, WEBP image or a PDF.")
    if fmt not in IMAGE_FORMATS:
        raise HTTPException(400, "Unsupported image format. Use PNG, JPG, GIF or WEBP.")
    if width * height > settings.MAX_IMAGE_PIXELS:
        raise HTTPException(400, "Image dimensions are too large.")
    ext, mime = IMAGE_FORMATS[fmt]
    return "image", ext, mime


def _store(data: bytes, rel_dir: str, ext: str) -> str:
    token = secrets.token_hex(16)
    abs_dir = os.path.join(settings.MEDIA_ROOT, *rel_dir.split("/"))
    os.makedirs(abs_dir, exist_ok=True)
    tmp_path = os.path.join(abs_dir, f".{token}.tmp")
    final_path = os.path.join(abs_dir, f"{token}.{ext}")
    with open(tmp_path, "wb") as fh:
        fh.write(data)
    os.replace(tmp_path, final_path)
    return f"{settings.MEDIA_URL}/{rel_dir}/{token}.{ext}"


def _safe_name(name: str | None) -> str:
    base = os.path.basename(name or "file")
    return "".join(c for c in base if c.isalnum() or c in "._- ")[:120] or "file"


@router.post("/question-media", response_model=MediaUploadOut)
def upload_question_media(file: UploadFile = File(...),
                          user: User = Depends(require_roles(Role.teacher, Role.admin))):
    data = _read_limited(file, settings.MAX_QUESTION_IMAGE_MB)
    kind, ext, mime = _sniff(data)
    if kind != "image":
        raise HTTPException(400, "Question media must be an image (PNG, JPG, GIF or WEBP).")
    shard = datetime.now(timezone.utc).strftime("%Y%m")
    url = _store(data, f"questions/{shard}", ext)
    return MediaUploadOut(url=url, name=_safe_name(file.filename), size=len(data), content_type=mime, kind=kind)


@router.post("/attempts/{attempt_id}/questions/{question_id}", response_model=MediaUploadOut)
def upload_answer_file(attempt_id: int, question_id: int, file: UploadFile = File(...),
                       db: DBSession = Depends(get_db), user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    if a.status != "in_progress":
        raise HTTPException(400, "Attempt is not in progress")
    deadline = _attempt_deadline(a)
    if deadline and datetime.now(timezone.utc) > deadline:
        raise HTTPException(400, "Time is up for this exam. Submit your exam now.")
    q = db.get(Question, question_id)
    if not q or q.exam_id != a.exam_id:
        raise HTTPException(404, "Question not found in this exam")
    if q.type != "file_upload":
        raise HTTPException(400, "This question does not accept file uploads")
    data = _read_limited(file, settings.MAX_ANSWER_FILE_MB)
    kind, ext, mime = _sniff(data)
    accept = (q.settings or {}).get("accept", "both")
    if accept != "both" and kind != accept:
        raise HTTPException(400, "Only images are accepted for this question." if accept == "image"
                            else "Only PDF files are accepted for this question.")
    url = _store(data, f"answers/{a.id}/{q.id}", ext)
    return MediaUploadOut(url=url, name=_safe_name(file.filename), size=len(data), content_type=mime, kind=kind)