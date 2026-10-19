
import argparse
import base64
import time
import requests
import socketio
import cv2

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--fps", type=int, default=6)
    args = ap.parse_args()
    r = requests.post(f"{args.server}/api/v1/auth/login",
                      json={"email": args.email, "password": args.password})
    r.raise_for_status()
    token = r.json()["access_token"]
    print(f"Logged in as {r.json()['name']}")
    sio = socketio.Client()
    sio.connect(args.server, socketio_path="socket.io")
    ack = sio.call("student:join", {"token": token})
    print("Joined session:", ack)
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    delay = 1.0 / args.fps
    print("Streaming webcam... Ctrl+C to stop")
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
            b64 = base64.b64encode(buf).decode()
            sio.emit("frame:webcam", {"image": b64})
            sio.emit("heartbeat", {})
            time.sleep(delay)
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        sio.disconnect()


if __name__ == "__main__":
    main()
