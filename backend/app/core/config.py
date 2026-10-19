from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "AI Proctor Backend"
    API_V1: str = "/api/v1"
    DEBUG: bool = True
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    DATABASE_URL: str = "postgresql+psycopg2://proctor:proctor@localhost:5432/proctor"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    ENABLE_AI: bool = True
    OBJECT_MODEL_PATH: str = "models/yolov26m.onnx"
    FRAME_SAMPLE_RATE: int = 1

    ENABLE_FACE_ID: bool = True
    FACE_MODEL_PATH: str = "models/arcface.onnx"
    FACE_MATCH_THRESHOLD: float = 0.38
    FACE_CHECK_EVERY: int = 5
    FACE_MISMATCH_STREAK: int = 3
    CAMERA_COVERED_MEAN: float = 25.0    
    CAMERA_COVERED_STD: float = 12.0     
    CAMERA_LOW_LIGHT_MEAN: float = 70.0
    CAMERA_OVEREXPOSED_MEAN: float = 225.0
    CAMERA_BLUR_VARIANCE_THRESHOLD: float = 35.0  
    CAMERA_ISSUE_FRAMES: int = 5          
    FACE_QUALITY_MIN_STD: float = 18.0           
    FACE_QUALITY_MIN_SHARPNESS: float = 25.0     
    FACE_QUALITY_STREAK_FRAMES: int = 2      
    FACE_EYE_MIN_CONTRAST: float = 22.0          
    FACE_EYE_MIN_EDGES: float = 0.03            
    FACE_MOUTH_MIN_CONTRAST: float = 12.0         
    FACE_MOUTH_MIN_EDGES: float = 0.015       
    FACE_MISSING_FRAMES_FOR_UNVERIFIED: int = 2


    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()