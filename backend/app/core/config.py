from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    PROJECT_NAME: str = "AI Proctor Backend"
    API_V1: str = "/api/v1"
    DEBUG: bool = True

    # Security
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database. PostgreSQL is the supported database for this system.
    # Local dev without Docker: postgresql+psycopg2://proctor:proctor@localhost:5432/proctor
    # Docker Compose: postgresql+psycopg2://proctor:proctor@db:5432/proctor
    DATABASE_URL: str = "postgresql+psycopg2://proctor:proctor@localhost:5432/proctor"

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    # AI - behavior pipeline (face mesh / gaze / head pose / objects)
    ENABLE_AI: bool = True
    OBJECT_MODEL_PATH: str = "models/yolov8n.onnx"
    FRAME_SAMPLE_RATE: int = 1  # analyze 1 of every N frames per student (1 = every frame)

    # AI - identity verification (ArcFace re-ID)
    ENABLE_FACE_ID: bool = True
    FACE_MODEL_PATH: str = "models/arcface.onnx"
    # Cosine similarity threshold below which a frame is considered a different
    # person. ArcFace embeddings are L2-normalized; ~0.35-0.45 is a reasonable
    # operating point depending on the exported model.
    FACE_MATCH_THRESHOLD: float = 0.38
    # Run an identity check every Nth analyzed (already-sampled) frame.
    FACE_CHECK_EVERY: int = 5
    # Consecutive mismatches required before an "Identity Mismatch" alert fires.
    FACE_MISMATCH_STREAK: int = 3
        # AI - camera health (covered/low-light/overexposed/blurry). These are
    # generic starting points, NOT validated against real hardware — real
    # webcam frames after JPEG compression + the 0.5x server-side downscale
    # look very different from clean synthetic test images, and most
    # webcams' auto-exposure/auto-gain keeps frames brighter than you'd
    # expect even when dim or partially covered. Watch the live brightness/
    # blur numbers in a teacher's Live Monitoring detail view (Student
    # Detail modal) against your actual camera hardware and adjust these to
    # match — there is no substitute for tuning against your own hardware.
    CAMERA_COVERED_MEAN: float = 25.0     # 0-255 grayscale mean, AND...
    CAMERA_COVERED_STD: float = 12.0      # ...std this low => lens covered
    CAMERA_LOW_LIGHT_MEAN: float = 70.0
    CAMERA_OVEREXPOSED_MEAN: float = 225.0
    CAMERA_BLUR_VARIANCE_THRESHOLD: float = 35.0  # Laplacian variance; lower = blurrier
    CAMERA_ISSUE_FRAMES: int = 5          # consecutive analyzed frames before alerting

    # AI - face visibility/occlusion gate for identity verification. Applied
    # to the ALIGNED FACE CROP specifically (not the whole frame), since a
    # hand/object covering just the face doesn't necessarily change overall
    # frame brightness. A genuinely visible face has natural texture (eyes,
    # brows, nose shadow, mouth detail); a covered/occluded region is
    # comparatively flat. Like the camera-health thresholds above, these are
    # starting points that benefit from tuning against real hardware/faces.
    FACE_QUALITY_MIN_STD: float = 18.0            # face-crop grayscale std; below this = likely covered
    FACE_QUALITY_MIN_SHARPNESS: float = 25.0      # face-crop Laplacian variance; below this = likely covered/blurred
    FACE_QUALITY_STREAK_FRAMES: int = 2           # consecutive low-quality frames before alerting "Face Covered"
    # Region checks on the aligned face crop (catch a hand/paper over the
    # eyes or mouth, which the whole-crop checks above miss).
    FACE_EYE_MIN_CONTRAST: float = 22.0           # eye band: median - 5th percentile brightness
    FACE_EYE_MIN_EDGES: float = 0.03              # eye band: fraction of Canny edge pixels
    FACE_MOUTH_MIN_CONTRAST: float = 12.0         # mouth band contrast (both mouth checks must fail)
    FACE_MOUTH_MIN_EDGES: float = 0.015           # mouth band edge fraction
    # Consecutive analyzed frames without a visible face before the live
    # identity status switches from "verified" to "no_face".
    FACE_MISSING_FRAMES_FOR_UNVERIFIED: int = 2

    FACE_LOGIN_REQUIRED: bool = True
    FACE_LOGIN_TOKEN_MINUTES: int = 5
    FACE_SCAN_FRONT_MAX_YAW: float = 10.0
    FACE_SCAN_NEAR_MAX_YAW: float = 22.0
    FACE_SCAN_MID_MAX_YAW: float = 35.0
    FACE_SCAN_SIDE_SHARPNESS_SCALE: float = 0.5
    FACE_SIDE_MATCH_THRESHOLD: float = 0.33
    FACE_PROFILE_MATCH_THRESHOLD: float = 0.28
    FACE_SCAN_CHAIN_THRESHOLD: float = 0.25
    FACE_SCAN_PROFILE_CHAIN_THRESHOLD: float = 0.12
    FACE_SCAN_MIN_PASS_RATIO: float = 0.6
    FACE_SCAN_HARD_FLOOR: float = 0.05
    FACE_PROFILE_MIN_WEIGHT: float = 1.0
    FACE_PROFILE_MIN_NEIGHBORS: int = 5
    FACE_PROFILE_SCAN_MIN_WEIGHT: float = 0.3
    FACE_PROFILE_SCAN_MIN_NEIGHBORS: int = 3
    FACE_PROFILE_MIN_SIZE_RATIO: float = 0.18
    FACE_PROFILE_MISMATCH_STREAK: int = 6
    FACE_SCAN_FRAMES_PER_SECOND: int = 8

    AI_WORKERS: int = 0
    AI_INTRA_OP_THREADS: int = 0
    AI_ONNX_PROVIDERS: str = ""
    DASHBOARD_TICK_INTERVAL_MS: int = 500
    MAX_FRAME_CHARS: int = 3_000_000
    SOCKET_MAX_MESSAGE_BYTES: int = 4_000_000
    LIVE_SESSION_IDLE_SECONDS: int = 10800
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 15
    DB_POOL_RECYCLE: int = 1800
    DB_STATEMENT_TIMEOUT_MS: int = 30000
    DB_WRITE_BATCH_MS: int = 500
    DB_WRITE_BATCH_MAX: int = 200
    DB_WRITE_QUEUE_MAX: int = 20000

    MEDIA_ROOT: str = "media"
    MEDIA_URL: str = "/media"
    MAX_QUESTION_IMAGE_MB: int = 5
    MAX_ANSWER_FILE_MB: int = 10
    MAX_IMAGE_PIXELS: int = 40000000


    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()