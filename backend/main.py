import os

import socketio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from app.core.config import settings
from app.db.session import Base, engine
from app import models  
from app.api import auth, students, alerts, analytics, courses, exams, attempts, media, face_scan
from app.realtime.socket_server import sio
limiter = Limiter(key_func=get_remote_address, default_limits=["240/minute"])

app = FastAPI(title=settings.PROJECT_NAME, debug=settings.DEBUG)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=settings.API_V1)
app.include_router(face_scan.router, prefix=settings.API_V1)
app.include_router(students.router, prefix=settings.API_V1)
app.include_router(alerts.router, prefix=settings.API_V1)
app.include_router(analytics.router, prefix=settings.API_V1)
app.include_router(courses.router, prefix=settings.API_V1)
app.include_router(exams.router, prefix=settings.API_V1)
app.include_router(attempts.router, prefix=settings.API_V1)
app.include_router(media.router, prefix=settings.API_V1)

os.makedirs(settings.MEDIA_DIR, exist_ok=True)
app.mount(settings.MEDIA_URL, StaticFiles(directory=settings.MEDIA_DIR), name="media")


@app.get("/health")
def health():
    from app.ai.analyzer import analyzer
    from app.ai.face_id import face_identifier
    return {"status": "ok", "ai_ready": analyzer.ready, "face_id_ready": face_identifier.ready}


socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")
