#!/usr/bin/env python3
"""
Whisper Server for tarteel-ai/whisper-tiny-ar-quran
"""

import os
import logging
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

from config import Config
from utils.audio_processor import AudioProcessor
from utils.model_manager import ModelManager

# Setup logging
os.makedirs("logs", exist_ok=True)
logging.basicConfig(
    level=getattr(logging, Config.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(Config.LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = Config.MAX_CONTENT_LENGTH
CORS(app)

# Initialize components
audio_processor = AudioProcessor(Config.TARGET_SAMPLE_RATE)
model_manager = ModelManager(Config.MODEL_NAME, Config.DEVICE)

# Global initialization flag
is_initialized = False

def initialize_server():
    """Initialize the server components."""
    global is_initialized
    if is_initialized:
        return
    
    try:
        logger.info("Initializing Whisper server...")
        logger.info(f"Model: {Config.MODEL_NAME}")
        logger.info(f"Device: {Config.DEVICE}")
        
        # Load the model
        model_manager.load_model()
        
        is_initialized = True
        logger.info("Server initialization completed successfully")
        
    except Exception as e:
        logger.error(f"Server initialization failed: {e}")
        raise

@app.before_request
def startup():
    """Initialize server on first request."""
    initialize_server()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    try:
        status = {
            'status': 'healthy' if is_initialized else 'initializing',
            'model': Config.MODEL_NAME,
            'device': Config.DEVICE,
            'timestamp': datetime.now().isoformat(),
            'version': '1.0.0'
        }
        
        if is_initialized:
            # Quick model test
            import torch
            test_audio = torch.zeros(16000)  # 1 second of silence
            _ = model_manager.transcribe(test_audio)
            status['model_status'] = 'ready'
        
        return jsonify(status), 200
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    """Main transcription endpoint."""
    start_time = datetime.now()
    temp_file_path = None
    
    try:
        # Ensure server is initialized
        if not is_initialized:
            initialize_server()
        
        # Check if file is present
        if 'file' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['file']
        if audio_file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        logger.info(f"Processing file: {audio_file.filename}")
        logger.info(f"Content type: {audio_file.content_type}")
        
        # Save temporary file
        temp_file_path = audio_processor.save_temp_audio(audio_file)
        
        # Load and preprocess audio
        waveform, sample_rate = audio_processor.load_audio(temp_file_path)
        processed_audio = audio_processor.preprocess_audio(waveform, sample_rate)
        
        logger.info(f"Audio loaded: {processed_audio.shape[0]/16000:.2f}s at {sample_rate}Hz")
        
        # Transcribe
        transcription = model_manager.transcribe(processed_audio)
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        logger.info(f"Transcription completed in {processing_time:.2f}s")
        logger.info(f"Result: {transcription[:100]}...")
        
        # Get query parameters for comparison (if provided)
        page = request.args.get('page')
        ayah = request.args.get('ayah')
        
        if page and ayah:
            # If page and ayah are provided, you can implement comparison logic here
            # For now, just return the transcription
            logger.info(f"Transcription request for page {page}, ayah {ayah}")
        
        # Return plain text response (matching your Node.js server format)
        return transcription, 200, {'Content-Type': 'text/plain; charset=utf-8'}
        
    except Exception as e:
        processing_time = (datetime.now() - start_time).total_seconds()
        logger.error(f"Transcription failed after {processing_time:.2f}s: {e}")
        
        error_response = {
            'error': 'Transcription failed',
            'details': str(e),
            'processing_time': processing_time
        }
        
        return jsonify(error_response), 500
        
    finally:
        # Cleanup temporary file
        if temp_file_path:
            audio_processor.cleanup_temp_file(temp_file_path)

@app.route('/model/info', methods=['GET'])
def model_info():
    """Get model information."""
    try:
        if not is_initialized:
            return jsonify({'error': 'Server not initialized'}), 503
        
        info = {
            'model_name': Config.MODEL_NAME,
            'device': Config.DEVICE,
            'target_sample_rate': Config.TARGET_SAMPLE_RATE,
            'max_audio_length': Config.MAX_AUDIO_LENGTH,
            'specialized_for': 'Quranic Arabic recitation',
            'model_type': 'Whisper Tiny',
            'languages': ['Arabic (Quranic)']
        }
        
        return jsonify(info), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    return jsonify({
        'error': 'File too large',
        'max_size': f"{Config.MAX_CONTENT_LENGTH / 1024 / 1024:.0f}MB"
    }), 413

@app.errorhandler(404)
def not_found(e):
    return jsonify({
        'error': 'Endpoint not found',
        'available_endpoints': {
            'GET /health': 'Health check',
            'GET /model/info': 'Model information',
            'POST /transcribe': 'Audio transcription'
        }
    }), 404

@app.errorhandler(500)
def internal_error(e):
    logger.error(f"Internal server error: {e}")
    return jsonify({
        'error': 'Internal server error',
        'message': 'Please check server logs for details'
    }), 500

if __name__ == '__main__':
    # Initialize server
    try:
        initialize_server()
        
        logger.info(f"Starting Whisper server on {Config.HOST}:{Config.PORT}")
        logger.info(f"Debug mode: {Config.DEBUG}")
        
        # Run the server
        app.run(
            host=Config.HOST,
            port=Config.PORT,
            debug=Config.DEBUG,
            threaded=True
        )
        
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise