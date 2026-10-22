"""
Socket.IO load simulator for the proctoring system.

JMeter cannot speak Socket.IO natively, and the webcam-frame stream is the
heaviest part of this system, so this script plays the role of N students:
  login -> start attempt -> enter exam -> connect socket -> student:join
  -> stream webcam frames (+ screen frames) like the real React client does.

Install once:
    pip install "python-socketio[client]==5.11.4" websocket-client requests opencv-python-headless numpy

Example (start small!):
    python socket_load.py --csv loadtest_users.csv --exam-id 2 --users 10 --image face.jpg --duration 120

Real browser behaviour copied from the frontend:
    webcam frame every 500 ms (2 FPS), 640x480 JPEG q0.6
    screen frame every 2000 ms, JPEG q0.5
    heartbeat every 15 s
"""
import argparse
import base64
import csv
import statistics
import threading
import time

import cv2
import numpy as np
import requests
import socketio

lock = threading.Lock()
S = dict(logged_in=0, joined=0, join_fail=0, login_fail=0, start_fail=0, enter_fail=0,
         disconnects=0, webcam_sent=0, screen_sent=0, ticks_rx=0, frames_rx=0, bytes_rx=0,
         bytes_tx=0, submitted=0)
join_ms, login_ms = [], []
stop = threading.Event()


def make_jpegs(path):
    if path:
        img = cv2.imread(path)
        if img is None:
            raise SystemExit(f"Cannot read image {path}")
    else:
        print("WARNING: no --image given, using a synthetic image (no face). The AI does less work "
              "on it, so results will be optimistic. Use a real webcam photo of a face.")
        img = (np.random.rand(480, 640, 3) * 255).astype("uint8")
    cam = cv2.resize(img, (640, 480))
    scr = cv2.resize(img, (1280, 720))
    _, a = cv2.imencode(".jpg", cam, [cv2.IMWRITE_JPEG_QUALITY, 60])
    _, b = cv2.imencode(".jpg", scr, [cv2.IMWRITE_JPEG_QUALITY, 50])
    return ("data:image/jpeg;base64," + base64.b64encode(a).decode(),
            "data:image/jpeg;base64," + base64.b64encode(b).decode())


def client(idx, row, a, cam_b64, scr_b64):
    base = a.server
    h = {}
    try:
        t0 = time.time()
        r = requests.post(f"{base}/api/v1/auth/login",
                          json={"email": row["email"], "password": row["password"]}, timeout=60)
        r.raise_for_status()
        with lock:
            S["logged_in"] += 1
            login_ms.append((time.time() - t0) * 1000)
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
    except Exception:
        with lock:
            S["login_fail"] += 1
        return
    try:
        r = requests.post(f"{base}/api/v1/exams/{a.exam_id}/start", headers=h, timeout=60)
        r.raise_for_status()
        attempt_id = r.json()["id"]
    except Exception:
        with lock:
            S["start_fail"] += 1
        return
    try:
        r = requests.post(f"{base}/api/v1/attempts/{attempt_id}/enter", headers=h, timeout=60)
        r.raise_for_status()
    except Exception:
        with lock:
            S["enter_fail"] += 1
        return

    sio = socketio.Client(reconnection=False)

    @sio.on("students:tick")
    def _tick(data):
        with lock:
            S["ticks_rx"] += 1
            S["bytes_rx"] += len(str(data))

    @sio.on("frame:webcam")
    def _fw(data):
        with lock:
            S["frames_rx"] += 1
            S["bytes_rx"] += len(data.get("image", ""))

    @sio.on("frame:screen")
    def _fs(data):
        with lock:
            S["frames_rx"] += 1
            S["bytes_rx"] += len(data.get("image", ""))

    @sio.event
    def disconnect():
        if not stop.is_set():
            with lock:
                S["disconnects"] += 1

    try:
        t0 = time.time()
        sio.connect(base, socketio_path="socket.io", transports=["websocket"], wait_timeout=30)
        ack = sio.call("student:join", {"token": token, "attempt_id": attempt_id}, timeout=30)
        if not (isinstance(ack, dict) and ack.get("ok")):
            raise RuntimeError(f"join refused: {ack}")
        with lock:
            S["joined"] += 1
            join_ms.append((time.time() - t0) * 1000)
    except Exception as e:
        with lock:
            S["join_fail"] += 1
        print(f"[user {idx}] socket join failed: {e}")
        return

    next_cam = next_scr = time.time()
    next_hb = time.time() + 15
    try:
        while not stop.is_set() and sio.connected:
            now = time.time()
            if now >= next_cam:
                sio.emit("frame:webcam", {"image": cam_b64})
                next_cam += 1.0 / a.fps
                with lock:
                    S["webcam_sent"] += 1
                    S["bytes_tx"] += len(cam_b64)
            if not a.no_screen and now >= next_scr:
                sio.emit("frame:screen", {"image": scr_b64})
                next_scr += 2.0
                with lock:
                    S["screen_sent"] += 1
                    S["bytes_tx"] += len(scr_b64)
            if now >= next_hb:
                sio.emit("heartbeat", {})
                next_hb += 15
            time.sleep(0.01)
    finally:
        try:
            if not a.no_submit:
                requests.post(f"{base}/api/v1/attempts/{attempt_id}/submit", headers=h, timeout=60)
                with lock:
                    S["submitted"] += 1
        except Exception:
            pass
        try:
            sio.disconnect()
        except Exception:
            pass


def health_probe(base, out):
    while not stop.is_set():
        t0 = time.time()
        try:
            requests.get(f"{base}/health", timeout=30)
            out.append((time.time(), (time.time() - t0) * 1000))
        except Exception:
            out.append((time.time(), 30000.0))
        time.sleep(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--csv", default="loadtest_users.csv")
    ap.add_argument("--exam-id", type=int, required=True)
    ap.add_argument("--users", type=int, default=10)
    ap.add_argument("--ramp", type=int, default=10, help="seconds to start all users")
    ap.add_argument("--duration", type=int, default=120, help="seconds to keep streaming after ramp")
    ap.add_argument("--fps", type=float, default=2.0, help="webcam frames per second per user")
    ap.add_argument("--image", default=None, help="jpg of a real face (recommended)")
    ap.add_argument("--no-screen", action="store_true")
    ap.add_argument("--no-submit", action="store_true")
    a = ap.parse_args()

    rows = list(csv.DictReader(open(a.csv)))[: a.users]
    if len(rows) < a.users:
        print(f"Only {len(rows)} users in the CSV; running with {len(rows)}.")
    cam_b64, scr_b64 = make_jpegs(a.image)
    print(f"webcam frame ~{len(cam_b64)/1024:.0f} KB, screen frame ~{len(scr_b64)/1024:.0f} KB (base64)")

    probe = []
    threading.Thread(target=health_probe, args=(a.server, probe), daemon=True).start()

    threads = []
    gap = a.ramp / max(1, len(rows))
    t_start = time.time()
    for i, row in enumerate(rows):
        t = threading.Thread(target=client, args=(i + 1, row, a, cam_b64, scr_b64), daemon=True)
        t.start()
        threads.append(t)
        time.sleep(gap)

    end = time.time() + a.duration
    last = dict(S)
    last_t = time.time()
    print("\n time | joined | webcamTX/s | screenTX/s | ticksRX/s | frames RX/s | RX MB/s | disc | /health ms (avg/max)")
    while time.time() < end:
        time.sleep(5)
        now = time.time()
        dt = now - last_t
        with lock:
            cur = dict(S)
        recent = [ms for ts, ms in probe if ts > now - 5]
        hs = f"{statistics.mean(recent):6.0f}/{max(recent):6.0f}" if recent else "   n/a"
        print(f"{now - t_start:5.0f} | {cur['joined']:6d} | {(cur['webcam_sent']-last['webcam_sent'])/dt:10.1f} | "
              f"{(cur['screen_sent']-last['screen_sent'])/dt:10.1f} | {(cur['ticks_rx']-last['ticks_rx'])/dt:9.1f} | "
              f"{(cur['frames_rx']-last['frames_rx'])/dt:11.1f} | {(cur['bytes_rx']-last['bytes_rx'])/dt/1e6:7.2f} | "
              f"{cur['disconnects']:4d} | {hs}")
        last, last_t = cur, now

    stop.set()
    for t in threads:
        t.join(timeout=20)

    def pct(v, p):
        v = sorted(v)
        return v[min(len(v) - 1, int(len(v) * p))] if v else float("nan")

    allh = [ms for _, ms in probe]
    print("\n================ SUMMARY ================")
    print(f"users requested         : {len(rows)}")
    print(f"login ok / fail         : {S['logged_in']} / {S['login_fail']}   (login ms median {pct(login_ms,.5):.0f}, p95 {pct(login_ms,.95):.0f})")
    print(f"start/enter failures    : {S['start_fail']} / {S['enter_fail']}")
    print(f"socket joined / failed  : {S['joined']} / {S['join_fail']}   (connect+join ms median {pct(join_ms,.5):.0f}, p95 {pct(join_ms,.95):.0f})")
    print(f"unexpected disconnects  : {S['disconnects']}")
    print(f"webcam frames sent      : {S['webcam_sent']}   screen frames sent: {S['screen_sent']}")
    print(f"data sent / received    : {S['bytes_tx']/1e6:.1f} MB / {S['bytes_rx']/1e6:.1f} MB")
    print(f"/health latency ms      : median {pct(allh,.5):.0f}, p95 {pct(allh,.95):.0f}, max {max(allh) if allh else 0:.0f}")
    print(f"submitted               : {S['submitted']}")


if __name__ == "__main__":
    main()