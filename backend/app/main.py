import logging
import os
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from app.core.config import settings
from app.db.session import Base, engine
from app import models  # noqa: F401
from app.api import auth, students, alerts, analytics, courses, exams, attempts, uploads, live_classes, media
from app.realtime.socket_server import sio, realtime_startup, realtime_shutdown, realtime_stats

logger = logging.getLogger("app.errors")

limiter = Limiter(key_func=get_remote_address, default_limits=["240/minute"])


class CatchServerErrors:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracked_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracked_send)
        except Exception:
            logger.exception("Unhandled server error on %s %s", scope.get("method"), scope.get("path"))
            if started:
                raise
            response = JSONResponse(
                {"detail": "Something went wrong on the server. Please try again."},
                status_code=500,
            )
            await response(scope, receive, send)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    await realtime_startup()
    try:
        yield
    finally:
        await realtime_shutdown()


if settings.SECRET_KEY.startswith("change-me"):
    if not settings.DEBUG:
        raise RuntimeError("SECRET_KEY is still the default value. Set a strong SECRET_KEY in the environment.")
    logger.warning("SECRET_KEY is the insecure default - set a strong SECRET_KEY before deploying.")

# Interactive API docs expose every endpoint; only serve them in debug mode.
app = FastAPI(
    title=settings.PROJECT_NAME, debug=settings.DEBUG, lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(CatchServerErrors)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router, prefix=settings.API_V1)
app.include_router(students.router, prefix=settings.API_V1)
app.include_router(alerts.router, prefix=settings.API_V1)
app.include_router(analytics.router, prefix=settings.API_V1)
app.include_router(courses.router, prefix=settings.API_V1)
app.include_router(exams.router, prefix=settings.API_V1)
app.include_router(attempts.router, prefix=settings.API_V1)
app.include_router(uploads.router, prefix=settings.API_V1)
app.include_router(live_classes.router, prefix=settings.API_V1)
app.include_router(media.router)  # authenticated student answer files (/media/answers/...)

# Only teacher-authored question images are served publicly. Student uploads
# live under /media/answers and are served by the authenticated media router.
_questions_dir = os.path.join(settings.MEDIA_ROOT, "questions")
os.makedirs(_questions_dir, exist_ok=True)
app.mount(f"{settings.MEDIA_URL}/questions", StaticFiles(directory=_questions_dir), name="media-questions")


@app.get(f"{settings.API_V1}/time")
def server_time():
    """Authoritative UTC clock so clients never rely on their own system time."""
    from datetime import datetime, timezone
    return {"utc": datetime.now(timezone.utc).isoformat()}


@app.get("/health")
def health():
    from app.ai.analyzer import analyzer
    from app.ai.face_id import face_identifier
    return {"status": "ok", "ai_ready": analyzer.ready, "face_id_ready": face_identifier.ready}


socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")