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
from app.api import auth, students, alerts, analytics, courses, exams, attempts, uploads
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


app = FastAPI(title=settings.PROJECT_NAME, debug=settings.DEBUG, lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(CatchServerErrors)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=settings.API_V1)
app.include_router(students.router, prefix=settings.API_V1)
app.include_router(alerts.router, prefix=settings.API_V1)
app.include_router(analytics.router, prefix=settings.API_V1)
app.include_router(courses.router, prefix=settings.API_V1)
app.include_router(exams.router, prefix=settings.API_V1)
app.include_router(attempts.router, prefix=settings.API_V1)
app.include_router(uploads.router, prefix=settings.API_V1)

os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
app.mount(settings.MEDIA_URL, StaticFiles(directory=settings.MEDIA_ROOT), name="media")


@app.get("/health")
def health():
    from app.ai.analyzer import analyzer
    from app.ai.face_id import face_identifier
    return {
        "status": "ok",
        "ai_ready": analyzer.ready,
        "face_id_ready": face_identifier.ready,
        "realtime": realtime_stats(),
    }


socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")