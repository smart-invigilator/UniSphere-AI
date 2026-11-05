# Live Classes — Architecture, Deployment and Operations

## 1. Architecture

```
 Browser (React + livekit-client)
   │  HTTPS REST: create/start/end, join token, chat, Q&A, hand, moderation
   ▼
 FastAPI backend ──────────────► PostgreSQL (classes, attendance, chat)
   │  Server API (HTTPS, signed admin JWT): create/delete room, mute, permissions,
   │  attributes, room metadata, send data
   ▼
 LiveKit SFU  ◄──────── WebRTC media (UDP 50000-60000, TCP 7881, TURN/TLS 5349) ─────── Browsers
   │  Signed webhooks: participant_joined / participant_left / room_finished
   └──────────────────────────────────────────► FastAPI /api/v1/live-classes/webhook
```

- **Media never passes through FastAPI.** Each participant uploads once to the SFU; the SFU forwards
  to subscribers (simulcast + adaptive stream + dynacast choose the right quality per viewer).
- **The backend is the authority.** Join tokens (15 min, HS256) encode exactly what a participant may
  publish. Students cannot publish data into the room (`canPublishData: false`) or change their own
  metadata, so chat, Q&A, reactions, hand-raises and requests are validated, rate-limited and stored by
  the backend, then fanned out through LiveKit's server `SendData` / participant attributes.
- **Ephemeral state lives in LiveKit**, not the database: who is speaking, hands, requests, spotlight,
  lock/chat flags (room metadata). Only durable data is written to PostgreSQL: classes, chat/Q&A,
  attendance (one row per person per class, updated from webhooks).

### Why LiveKit
| Option | Verdict |
|---|---|
| Peer-to-peer mesh | Each student uploads N copies — unusable beyond ~5 people |
| Janus / mediasoup | Capable, but you must build signaling, simulcast policy, reconnection and scaling yourself |
| **LiveKit (chosen)** | Open-source SFU (Apache-2.0), single binary, built-in simulcast/dynacast/adaptive stream, congestion control, reconnection, TURN, multi-node via Redis, official JS SDK |

The official LiveKit **Python** SDK was deliberately not used: it requires protobuf ≥ 5, which breaks
MediaPipe 0.10.14 (protobuf < 5) used by your AI pipeline. `app/services/livekit.py` implements the
small subset needed (tokens, Twirp server API, webhook verification) with `python-jose` and `requests`,
which you already depend on.

## 2. Database (migration `0008_live_classes`)
- `live_classes` — course, teacher, title, schedule, status (`scheduled|live|ended|cancelled`),
  unique `room_name`, unique shareable `meeting_code`, `settings` JSON (chat/Q&A, lock, student
  mic/camera/screen defaults, per-student grants, removed students, spotlight).
  Indexes: course, teacher, meeting code, (course,status), (status,scheduled_start).
- `live_class_attendance` — UNIQUE(live_class_id, user_id); first/last join, last leave, total
  seconds, join count, connected flag. Reconnects update the same row.
- `live_class_messages` — chat and questions, answered/hidden flags, index (class, created_at).

## 3. Environment variables (backend `.env`)
| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | Browser-facing URL, `wss://live.your-domain.com` in production |
| `LIVEKIT_API_URL` | Optional server-to-server URL (e.g. `http://livekit:7880` in Docker) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Must match `keys:` in `livekit.yaml`. Secret ≥ 32 random chars. Never in frontend code |
| `LIVE_TOKEN_TTL_SECONDS` | Join token lifetime (default 900). LiveKit refreshes tokens for connected clients |
| `LIVE_MAX_PARTICIPANTS` | Room cap (default 100) |
| `LIVE_ROOM_EMPTY_TIMEOUT_SECONDS` | Room closes (and class auto-ends) after being empty this long |
| `LIVE_ATTENDANCE_MIN_SECONDS` | Minimum time in class to count as present (default 60) |

Without these variables the rest of the app works normally; live class actions return a clear
"not set up on this server" message.

## 4. Local development
```bash
# 1. Media server (Windows: download livekit_<ver>_windows_amd64.zip from GitHub releases)
livekit-server --config deploy/livekit/livekit.dev.yaml
# 2. Backend (.env: LIVEKIT_URL=ws://localhost:7880, LIVEKIT_API_KEY=devkey,
#    LIVEKIT_API_SECRET=<same secret as livekit.dev.yaml>)
alembic upgrade head
uvicorn app.main:socket_app --host 0.0.0.0 --port 8000
# 3. Frontend
npm install && npm run dev
```
Camera/microphone require a secure context: `localhost` works; other hosts need HTTPS.

## 5. Production deployment
1. **LiveKit host(s):** a VM with a public IP (not behind HTTP-only load balancers for media).
   Open: TCP 443 (signaling via reverse proxy → 7880), UDP 50000–60000 (media), TCP 7881 (media
   fallback), UDP 3478 + TCP 5349 (TURN). Use `deploy/livekit/livekit.production.yaml`.
2. **TLS:** terminate `wss://live.your-domain.com` at Caddy/nginx/ALB and proxy to `7880` with
   WebSocket upgrade enabled. TURN/TLS needs its own certificate (`turn.your-domain.com`).
3. **Webhooks:** the LiveKit host must reach `https://api.your-domain.com/api/v1/live-classes/webhook`.
   Requests are verified with the API secret and a SHA-256 body hash.
4. **Version pinning:** tested with LiveKit server 1.13.11 and livekit-client 2.23.0. For production,
   pin a server release that has been public for at least two weeks.

## 6. Scaling
- **More classes / students:** run several LiveKit nodes with the same `redis:` block; LiveKit places
  each room on one node and routes participants there. Add nodes without code changes.
- **Backend:** stateless for live classes (all state in PostgreSQL / LiveKit) — scale horizontally
  behind a load balancer. Rate limiters are per-process (move to Redis if you need global limits).
- **Very large lectures (> 300 viewers):** keep students as subscribers only (default when mic/camera
  are off); consider LiveKit Egress → HLS for thousands of passive viewers.
- **Monitoring:** LiveKit exposes Prometheus metrics (`prometheus_port` in config); backend `/health`.

## 7. Security summary
- JWT auth on every endpoint; course ownership/enrollment checked server-side on every action.
- Short-lived join tokens with explicit `canPublishSources`; no data publishing; no self-metadata edits.
- Permission changes, mutes and removals are enforced by the SFU, not just the UI.
- Removed students and locked classes are refused new tokens. Meeting links only work for enrolled users.
- Webhooks verified (HS256 + body hash); chat is plain text (React-escaped), length-limited, rate-limited.
- Secrets only in backend `.env`; the browser receives a per-user, per-room token.

## 8. Measured results (test machine: 1 CPU core, 3 GB RAM, loopback network)
| Test | Result |
|---|---|
| Backend tests | 62 passed (13 new live-class tests) |
| Real-browser E2E (teacher + 2–4 students, real LiveKit + webhooks) | 11/11 checks, 2 consecutive runs |
| Camera → remote screen latency | median 134–256 ms, p95 276–362 ms (3 browsers + all servers on 1 core) |
| Screen share → remote screen latency | median 178–227 ms, p95 273–399 ms |
| SFU, 1 class × 10 / 25 / 50 subscribers | 0% loss; CPU 5% / 8% / 13%; RSS 72 / 95 / 137 MB |
| SFU, 3 concurrent classes × 15 subscribers | 0% loss in every class; CPU 7% |

These are lab numbers on loopback. Real-world latency adds network round-trip time; capacity depends
on the host. Re-run `lk load-test` on your production hardware before relying on a capacity figure.

## 9. Known limitations
- Tested on Chromium only. Speaker selection: Chrome/Edge/Firefox (not Safari). Screen sharing on
  mobile browsers is not supported by iOS/Android browsers.
- Network-impairment testing was not conclusive (no traffic shaping available on the test machine).
  Validate on a real network (e.g. `tc qdisc add dev eth0 root netem delay 100ms loss 3%` on Linux).
- Not implemented: recording (needs LiveKit Egress + object storage), virtual backgrounds
  (`@livekit/track-processors`, ~MBs of WASM), whiteboard, breakout rooms, captions, waiting room.
- "Class started" notifications on the student list refresh every 30 s while the page is visible.

## 10. Costs
- Self-hosted LiveKit: no licence fees; you pay for VMs and **egress bandwidth**. One 720p/540p
  simulcast camera to 50 students ≈ 0.3 Mbps × 50 ≈ 15–17 Mbps from the SFU (≈ 7 GB/hour).
- TURN relays add bandwidth for users behind strict firewalls.
- LiveKit Cloud (managed) is an alternative billed per participant-minute and bandwidth — no code
  changes needed besides `LIVEKIT_URL` / keys.