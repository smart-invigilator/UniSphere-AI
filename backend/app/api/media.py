
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.api.deps import require_roles
from app.core.config import settings
from app.models.user import Role, User

router = APIRouter(prefix="/media", tags=["media"])

_ALLOWED = {"PNG": ("png", "PNG"), "JPEG": ("jpg", "JPEG"), "WEBP": ("jpg", "JPEG")}


def _store(data: bytes, ext: str) -> str:
    now = datetime.now(timezone.utc)
    rel = f"questions/{now:%Y}/{now:%m}/{uuid.uuid4().hex}.{ext}"
    path = Path(settings.MEDIA_DIR) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"{settings.MEDIA_URL.rstrip('/')}/{rel}"


@router.post("/question-image", status_code=201)
def upload_question_image(file: UploadFile = File(...),
                          user: User = Depends(require_roles(Role.teacher, Role.admin))):
    data = file.file.read(settings.MAX_QUESTION_IMAGE_BYTES + 1)
    if len(data) > settings.MAX_QUESTION_IMAGE_BYTES:
        raise HTTPException(413, f"Image is too large (max {settings.MAX_QUESTION_IMAGE_BYTES // (1024 * 1024)} MB)")
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        if fmt not in _ALLOWED:
            raise HTTPException(415, "Only PNG, JPEG or WEBP images are allowed")
        if img.width * img.height > settings.MAX_QUESTION_IMAGE_PIXELS:   
            raise HTTPException(413, "Image dimensions are too large")
        img.load()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        raise HTTPException(400, "That file is not a valid image")

    img = ImageOps.exif_transpose(img)                       
    if img.mode in ("RGBA", "LA", "P"):                      
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    side = settings.QUESTION_IMAGE_MAX_SIDE
    img.thumbnail((side, side), Image.LANCZOS)              

    ext, save_fmt = _ALLOWED[fmt]
    out = io.BytesIO()
    if save_fmt == "PNG":
        img.save(out, "PNG", optimize=True)
    else:
        img.save(out, "JPEG", quality=85, optimize=True, progressive=True)  
    url = _store(out.getvalue(), ext)
    return {"url": url, "width": img.width, "height": img.height, "bytes": out.tell()}
