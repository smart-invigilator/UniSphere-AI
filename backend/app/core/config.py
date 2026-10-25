# from pydantic_settings import BaseSettings, SettingsConfigDict


# class Settings(BaseSettings):
#     model_config = SettingsConfigDict(env_file=".env", extra="ignore")

#     PROJECT_NAME: str = "AI Proctor Backend"
#     API_V1: str = "/api/v1"
#     DEBUG: bool = True
#     SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
#     ALGORITHM: str = "HS256"
#     ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
#     REFRESH_TOKEN_EXPIRE_DAYS: int = 7
#     DATABASE_URL: str = "postgresql+psycopg2://proctor:proctor@localhost:5432/proctor"
#     CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
#     ENABLE_AI: bool = True
#     OBJECT_MODEL_PATH: str = "models/yolov26m.onnx"
#     FRAME_SAMPLE_RATE: int = 1

#     ENABLE_FACE_ID: bool = True
#     FACE_MODEL_PATH: str = "models/arcface.onnx"
#     FACE_MATCH_THRESHOLD: float = 0.38
#     FACE_CHECK_EVERY: int = 5
#     FACE_MISMATCH_STREAK: int = 3
#     CAMERA_COVERED_MEAN: float = 25.0    
#     CAMERA_COVERED_STD: float = 12.0     
#     CAMERA_LOW_LIGHT_MEAN: float = 70.0
#     CAMERA_OVEREXPOSED_MEAN: float = 225.0
#     CAMERA_BLUR_VARIANCE_THRESHOLD: float = 35.0  
#     CAMERA_ISSUE_FRAMES: int = 5          
#     FACE_QUALITY_MIN_STD: float = 18.0           
#     FACE_QUALITY_MIN_SHARPNESS: float = 25.0     
#     FACE_QUALITY_STREAK_FRAMES: int = 2      
#     FACE_EYE_MIN_CONTRAST: float = 22.0          
#     FACE_EYE_MIN_EDGES: float = 0.03            
#     FACE_MOUTH_MIN_CONTRAST: float = 12.0         
#     FACE_MOUTH_MIN_EDGES: float = 0.015       
#     FACE_MISSING_FRAMES_FOR_UNVERIFIED: int = 2


#     @property
#     def cors_list(self) -> list[str]:
#         return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


# settings = Settings()


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

    FACE_SCAN_REQUIRED_FOR_LOGIN: bool = True      
    FACE_SCAN_REQUIRED_FOR_REGISTER: bool = True
    FACE_SCAN_ENROLL_ON_FIRST_LOGIN: bool = True
    FACE_SCAN_TOKEN_MINUTES: int = 5              
    FACE_SCAN_TICKET_MINUTES: int = 10             
    FACE_SCAN_MAX_FAILED_SESSIONS: int = 5      
    FACE_SCAN_LOCKOUT_MINUTES: int = 10          
    FACE_SCAN_MAX_SESSIONS: int = 300              
    FACE_SCAN_DEBUG: bool = True               
    FACE_SCAN_YAW_TARGET_DEG: float = 22.0        
    FACE_SCAN_PITCH_TARGET_DEG: float = 13.0      
    FACE_SCAN_CONSEC_MIN_SIM: float = 0.30       
    FACE_SCAN_ANCHOR_SIM_FRONT: float = 0.30     
    FACE_SCAN_ANCHOR_SIM_SIDE: float = 0.28      
    FACE_SCAN_FRONT_MIN_SIM: float = 0.40        
    FACE_SCAN_LEGACY_MIN_SIM: float = 0.38        
    FACE_SCAN_SECTOR_MIN_SIM: float = 0.30       
    FACE_SCAN_MAX_SECTOR_MISSES: int = 1
    FACE_SCAN_MAX_RESTARTS: int = 3              
    FACE_SCAN_MAX_SECONDS: float = 120.0           
    MEDIA_DIR: str = "media"
    MEDIA_URL: str = "/media"
    MAX_QUESTION_IMAGE_BYTES: int = 5 * 1024 * 1024
    MAX_QUESTION_IMAGE_PIXELS: int = 25_000_000
    QUESTION_IMAGE_MAX_SIDE: int = 1600

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()