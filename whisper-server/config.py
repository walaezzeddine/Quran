import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Model settings
    MODEL_NAME = "tarteel-ai/whisper-tiny-ar-quran"
    DEVICE = "cuda" if os.getenv("USE_GPU", "false").lower() == "true" else "cpu"
    
    # Server settings
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", 5000))
    DEBUG = os.getenv("DEBUG", "false").lower() == "true"
    
    # Audio processing
    TARGET_SAMPLE_RATE = 16000
    MAX_AUDIO_LENGTH = 30  # seconds
    
    # File upload
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB
    UPLOAD_FOLDER = "temp_uploads"
    
    # Logging
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    LOG_FILE = "logs/whisper_server.log"