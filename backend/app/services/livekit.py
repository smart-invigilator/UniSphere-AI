import base64
import hashlib
import hmac
import json
import logging
import threading
import time
from typing import Any

import requests
from jose import jwt, JWTError

from app.core.config import settings

logger = logging.getLogger(__name__)

SOURCE_CAMERA = "camera"
SOURCE_MICROPHONE = "microphone"
SOURCE_SCREEN = "screen_share"
SOURCE_SCREEN_AUDIO = "screen_share_audio"
ALL_SOURCES = [SOURCE_CAMERA, SOURCE_MICROPHONE, SOURCE_SCREEN, SOURCE_SCREEN_AUDIO]
_PROTO_SOURCE = {
    SOURCE_CAMERA: "CAMERA",
    SOURCE_MICROPHONE: "MICROPHONE",
    SOURCE_SCREEN: "SCREEN_SHARE",
    SOURCE_SCREEN_AUDIO: "SCREEN_SHARE_AUDIO",
}
_SOURCE_FROM_PROTO = {v: k for k, v in _PROTO_SOURCE.items()}
_SOURCE_FROM_PROTO.update({"1": SOURCE_CAMERA, "2": SOURCE_MICROPHONE, "3": SOURCE_SCREEN, "4": SOURCE_SCREEN_AUDIO})


class LiveKitError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class LiveKitNotConfigured(LiveKitError):
    pass


def is_configured() -> bool:
    return bool(settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET)


def _require_config() -> None:
    if not is_configured():
        raise LiveKitNotConfigured("Live classes are not configured on this server (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).")


def identity_for(user_id: int) -> str:
    return f"u{user_id}"


def user_id_from_identity(identity: str | None) -> int | None:
    if not identity or not identity.startswith("u"):
        return None
    try:
        return int(identity[1:])
    except ValueError:
        return None


def create_join_token(*, room: str, identity: str, name: str, metadata: dict, attributes: dict | None = None,
                      can_publish_sources: list[str], ttl_seconds: int | None = None) -> str:
    _require_config()
    now = int(time.time())
    ttl = ttl_seconds or settings.LIVE_TOKEN_TTL_SECONDS
    claims = {
        "iss": settings.LIVEKIT_API_KEY,
        "sub": identity,
        "nbf": now - 5,
        "exp": now + ttl,
        "jti": identity,
        "name": name,
        "metadata": json.dumps(metadata, separators=(",", ":")),
        "video": {
            "roomJoin": True,
            "room": room,
            "canSubscribe": True,
            "canPublish": bool(can_publish_sources),
            "canPublishData": False,
            "canPublishSources": list(can_publish_sources),
            "canUpdateOwnMetadata": False,
        },
    }
    if attributes:
        claims["attributes"] = {k: str(v) for k, v in attributes.items()}
    return jwt.encode(claims, settings.LIVEKIT_API_SECRET, algorithm="HS256")


def _admin_token(room: str | None = None) -> str:
    now = int(time.time())
    video: dict[str, Any] = {"roomCreate": True, "roomList": True, "roomAdmin": True}
    if room:
        video["room"] = room
    claims = {"iss": settings.LIVEKIT_API_KEY, "sub": "unisphere-backend", "nbf": now - 5, "exp": now + 120, "video": video}
    return jwt.encode(claims, settings.LIVEKIT_API_SECRET, algorithm="HS256")


def _http_base() -> str:
    if settings.LIVEKIT_API_URL:
        return settings.LIVEKIT_API_URL.rstrip("/")
    url = settings.LIVEKIT_URL.rstrip("/")
    if url.startswith("wss://"):
        return "https://" + url[len("wss://"):]
    if url.startswith("ws://"):
        return "http://" + url[len("ws://"):]
    return url


_session_lock = threading.Lock()
_session: requests.Session | None = None


def _http() -> requests.Session:
    global _session
    if _session is None:
        with _session_lock:
            if _session is None:
                s = requests.Session()
                adapter = requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=32, max_retries=0)
                s.mount("http://", adapter)
                s.mount("https://", adapter)
                _session = s
    return _session


IDEMPOTENT = {"ListParticipants", "GetParticipant", "ListRooms", "UpdateRoomMetadata", "UpdateParticipant", "MutePublishedTrack"}


def _call(method: str, body: dict, room: str | None = None) -> dict:
    _require_config()
    url = f"{_http_base()}/twirp/livekit.RoomService/{method}"
    attempts = 2 if method in IDEMPOTENT else 1
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            resp = _http().post(
                url,
                data=json.dumps(body),
                headers={"Authorization": f"Bearer {_admin_token(room)}", "Content-Type": "application/json"},
                timeout=settings.LIVEKIT_API_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            last_error = exc
            logger.warning("LiveKit %s request failed (attempt %s): %s", method, attempt + 1, exc)
            continue
        if resp.status_code == 200:
            return resp.json() if resp.content else {}
        try:
            detail = resp.json().get("msg") or resp.text
        except ValueError:
            detail = resp.text
        if resp.status_code == 404:
            raise LiveKitError(detail or "not found", status=404)
        if resp.status_code >= 500 and attempt + 1 < attempts:
            last_error = LiveKitError(detail, status=resp.status_code)
            continue
        raise LiveKitError(detail or f"LiveKit {method} failed", status=resp.status_code)
    raise LiveKitError(f"The live class media server is unreachable ({last_error}).")


def create_room(name: str, metadata: dict, max_participants: int) -> dict:
    return _call("CreateRoom", {
        "name": name,
        "empty_timeout": settings.LIVE_ROOM_EMPTY_TIMEOUT_SECONDS,
        "departure_timeout": settings.LIVE_ROOM_DEPARTURE_TIMEOUT_SECONDS,
        "max_participants": max_participants,
        "metadata": json.dumps(metadata, separators=(",", ":")),
    })


def delete_room(name: str) -> None:
    try:
        _call("DeleteRoom", {"room": name}, room=name)
    except LiveKitError as exc:
        if exc.status != 404:
            raise


def update_room_metadata(name: str, metadata: dict) -> None:
    try:
        _call("UpdateRoomMetadata", {"room": name, "metadata": json.dumps(metadata, separators=(",", ":"))}, room=name)
    except LiveKitError as exc:
        if exc.status != 404:
            raise


def list_participants(room: str) -> list[dict]:
    try:
        return _call("ListParticipants", {"room": room}, room=room).get("participants") or []
    except LiveKitError as exc:
        if exc.status == 404:
            return []
        raise


def remove_participant(room: str, identity: str) -> None:
    try:
        _call("RemoveParticipant", {"room": room, "identity": identity}, room=room)
    except LiveKitError as exc:
        if exc.status != 404:
            raise


def track_source(track: dict) -> str | None:
    return _SOURCE_FROM_PROTO.get(str(track.get("source", "")))


def mute_published_track(room: str, identity: str, track_sid: str, muted: bool = True) -> None:
    _call("MutePublishedTrack", {"room": room, "identity": identity, "track_sid": track_sid, "muted": muted}, room=room)


def update_participant(room: str, identity: str, *, sources: list[str] | None = None,
                       attributes: dict | None = None) -> None:
    body: dict[str, Any] = {"room": room, "identity": identity}
    if sources is not None:
        body["permission"] = {
            "can_subscribe": True,
            "can_publish": bool(sources),
            "can_publish_data": False,
            "can_publish_sources": [_PROTO_SOURCE[s] for s in sources],
        }
    if attributes is not None:
        body["attributes"] = {k: str(v) for k, v in attributes.items()}
    try:
        _call("UpdateParticipant", body, room=room)
    except LiveKitError as exc:
        if exc.status != 404:
            raise


def send_data(room: str, topic: str, payload: dict, reliable: bool = True,
              destination_identities: list[str] | None = None) -> None:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body: dict[str, Any] = {
        "room": room,
        "data": base64.b64encode(raw).decode("ascii"),
        "kind": "RELIABLE" if reliable else "LOSSY",
        "topic": topic,
    }
    if destination_identities:
        body["destination_identities"] = destination_identities
    try:
        _call("SendData", body, room=room)
    except LiveKitError as exc:
        if exc.status != 404:
            raise


def verify_webhook(body: bytes, auth_header: str | None) -> dict:
    _require_config()
    if not auth_header:
        raise LiveKitError("missing webhook authorization", status=401)
    token = auth_header.split(" ", 1)[1] if auth_header.lower().startswith("bearer ") else auth_header
    try:
        claims = jwt.decode(
            token, settings.LIVEKIT_API_SECRET, algorithms=["HS256"],
            options={"verify_aud": False}, issuer=settings.LIVEKIT_API_KEY,
        )
    except JWTError as exc:
        raise LiveKitError(f"invalid webhook signature: {exc}", status=401)
    expected = claims.get("sha256")
    actual = base64.b64encode(hashlib.sha256(body).digest()).decode("ascii")
    if not expected or not hmac.compare_digest(str(expected), actual):
        raise LiveKitError("webhook body hash mismatch", status=401)
    try:
        return json.loads(body)
    except ValueError:
        raise LiveKitError("webhook body is not JSON", status=400)