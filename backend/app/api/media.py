"""Authenticated access to students' uploaded answer files.

Question images (teacher-authored reference material) stay on the static
/media/questions mount. Anything a student uploads as an answer is private:
only that student, the course teacher, or an admin may download it.

<img>/<a> tags can't send an Authorization header, so the access token may
also be passed as ?access_token=<jwt>.
"""
import os
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DBSession

from app.api.attempts import _get_attempt, _own_attempt
from app.api.deps import get_user_from_token
from app.core.config import settings
from app.core.refs import ATTEMPT, decode_ref
from app.db.session import get_db
from app.models.user import Role

router = APIRouter(tags=["media"])

_FILE_RE = re.compile(r"^[0-9a-f]{32}\.(png|jpg|gif|webp|pdf)$")


@router.get(f"{settings.MEDIA_URL}/answers/{{attempt_id}}/{{question_id}}/{{filename}}", include_in_schema=False)
def get_answer_file(attempt_id: str, question_id: int, filename: str, request: Request,
                    access_token: str | None = Query(default=None), db: DBSession = Depends(get_db)):
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else access_token
    user = get_user_from_token(token, db)

    if not _FILE_RE.match(filename):
        raise HTTPException(404, "File not found")
    # New URLs carry an opaque reference; URLs stored in older answers carry the
    # numeric id. Both are authorized below, so legacy links keep working for
    # the owner/teacher only.
    try:
        attempt_id = int(attempt_id) if attempt_id.isdigit() else decode_ref(ATTEMPT, attempt_id)
    except ValueError:
        raise HTTPException(404, "File not found")
    a = _get_attempt(attempt_id, db)
    if user.role == Role.student:
        _own_attempt(attempt_id, user, db)
    elif a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")

    root = os.path.realpath(os.path.join(settings.MEDIA_ROOT, "answers", str(attempt_id), str(question_id)))
    path = os.path.realpath(os.path.join(root, filename))
    if not path.startswith(root + os.sep) or not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
