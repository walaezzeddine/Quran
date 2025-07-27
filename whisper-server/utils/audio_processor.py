import torch
import torchaudio
import librosa
import soundfile as sf
import numpy as np
from typing import Tuple, Optional
import tempfile
import os
import subprocess
import logging
from pydub import AudioSegment
import io

logger = logging.getLogger(__name__)

class AudioProcessor:
    def __init__(self, target_sample_rate: int = 16000):
        self.target_sample_rate = target_sample_rate
        logger.info(f"AudioProcessor initialized with target sample rate: {target_sample_rate}Hz")
   
    def load_audio(self, file_path: str) -> Tuple[torch.Tensor, int]:
        """Load audio file with comprehensive format support including M4A."""
        logger.info(f"Loading audio file: {file_path}")
        
        # Get file extension
        _, ext = os.path.splitext(file_path.lower())
        logger.info(f"File extension: {ext}")
        
        # Method 1: Try pydub first (best for M4A)
        if ext in ['.m4a', '.mp4', '.aac']:
            try:
                logger.info("Trying pydub for M4A/AAC file...")
                waveform, sample_rate = self._load_with_pydub(file_path)
                logger.info(f"Successfully loaded with pydub: {waveform.shape}, sr={sample_rate}")
                return waveform, sample_rate
            except Exception as e:
                logger.warning(f"pydub failed: {e}")
        
        # Method 2: Try torchaudio
        try:
            logger.info("Trying torchaudio...")
            waveform, sample_rate = torchaudio.load(file_path)
            logger.info(f"Successfully loaded with torchaudio: {waveform.shape}, sr={sample_rate}")
            return waveform, sample_rate
        except Exception as e:
            logger.warning(f"torchaudio failed: {e}")
        
        # Method 3: Try librosa with different backends
        try:
            logger.info("Trying librosa...")
            audio, sr = librosa.load(file_path, sr=None)
            waveform = torch.from_numpy(audio).unsqueeze(0) if audio.ndim == 1 else torch.from_numpy(audio.T)
            logger.info(f"Successfully loaded with librosa: {waveform.shape}, sr={sr}")
            return waveform, sr
        except Exception as e:
            logger.warning(f"librosa failed: {e}")
        
        # Method 4: Try soundfile
        try:
            logger.info("Trying soundfile...")
            audio, sr = sf.read(file_path)
            if len(audio.shape) > 1:
                audio = audio.T  # soundfile returns (frames, channels), we want (channels, frames)
                waveform = torch.from_numpy(audio)
            else:
                waveform = torch.from_numpy(audio).unsqueeze(0)
            logger.info(f"Successfully loaded with soundfile: {waveform.shape}, sr={sr}")
            return waveform, sr
        except Exception as e:
            logger.warning(f"soundfile failed: {e}")
        
        # Method 5: Try converting with pydub and then loading
        try:
            logger.info("Trying pydub conversion to WAV...")
            wav_path = self._convert_to_wav_with_pydub(file_path)
            try:
                # Try loading the converted WAV
                waveform, sample_rate = torchaudio.load(wav_path)
                logger.info(f"Successfully loaded converted WAV: {waveform.shape}, sr={sample_rate}")
                return waveform, sample_rate
            finally:
                # Clean up converted file
                if os.path.exists(wav_path):
                    os.unlink(wav_path)
        except Exception as e:
            logger.warning(f"pydub conversion failed: {e}")
        
        # Method 6: Try ffmpeg as last resort
        try:
            logger.info("Trying ffmpeg conversion...")
            converted_path = self._convert_with_ffmpeg(file_path)
            try:
                waveform, sample_rate = torchaudio.load(converted_path)
                logger.info(f"Successfully loaded ffmpeg converted file: {waveform.shape}, sr={sample_rate}")
                return waveform, sample_rate
            finally:
                if os.path.exists(converted_path):
                    os.unlink(converted_path)
        except Exception as e:
            logger.warning(f"ffmpeg conversion failed: {e}")
        
        raise Exception(f"Failed to load audio file {file_path}. Tried all available methods.")
    
    def _load_with_pydub(self, file_path: str) -> Tuple[torch.Tensor, int]:
        """Load audio using pydub (excellent for M4A files)."""
        # Load with pydub
        audio = AudioSegment.from_file(file_path)
        
        # Convert to mono if stereo
        if audio.channels > 1:
            audio = audio.set_channels(1)
        
        # Get sample rate
        sample_rate = audio.frame_rate
        
        # Convert to numpy array
        audio_array = np.array(audio.get_array_of_samples(), dtype=np.float32)
        
        # Normalize to [-1, 1] range
        if audio.sample_width == 1:  # 8-bit
            audio_array = audio_array / 128.0
        elif audio.sample_width == 2:  # 16-bit
            audio_array = audio_array / 32768.0
        elif audio.sample_width == 4:  # 32-bit
            audio_array = audio_array / 2147483648.0
        
        # Convert to torch tensor
        waveform = torch.from_numpy(audio_array).unsqueeze(0)
        
        return waveform, sample_rate
    
    def _convert_to_wav_with_pydub(self, input_path: str) -> str:
        """Convert audio file to WAV using pydub."""
        # Create temporary WAV file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
            output_path = tmp_file.name
        
        # Load and convert with pydub
        audio = AudioSegment.from_file(input_path)
        
        # Convert to mono and set sample rate
        audio = audio.set_channels(1).set_frame_rate(self.target_sample_rate)
        
        # Export as WAV
        audio.export(output_path, format="wav")
        
        logger.info(f"pydub conversion successful: {output_path}")
        return output_path
    
    def _convert_with_ffmpeg(self, input_path: str) -> str:
        """Convert audio file to WAV using ffmpeg."""
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
            output_path = tmp_file.name
        
        cmd = [
            'ffmpeg', '-i', input_path,
            '-acodec', 'pcm_s16le',
            '-ar', str(self.target_sample_rate),
            '-ac', '1',  # Convert to mono
            '-y',  # Overwrite output file
            output_path
        ]
        
        logger.info(f"Running ffmpeg command: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                raise Exception(f"ffmpeg failed: {result.stderr}")
            
            logger.info("ffmpeg conversion successful")
            return output_path
            
        except subprocess.TimeoutExpired:
            raise Exception("ffmpeg conversion timed out")
        except FileNotFoundError:
            raise Exception("ffmpeg not found. Please install ffmpeg.")
   
    def preprocess_audio(self, waveform: torch.Tensor, sample_rate: int) -> torch.Tensor:
        """Preprocess audio for Whisper model."""
        logger.info(f"Preprocessing audio: shape={waveform.shape}, sr={sample_rate}")
        
        # Convert to mono if stereo
        if waveform.shape[0] > 1:
            waveform = torch.mean(waveform, dim=0, keepdim=True)
            logger.info("Converted to mono")
       
        # Resample to target sample rate if needed
        if sample_rate != self.target_sample_rate:
            logger.info(f"Resampling from {sample_rate}Hz to {self.target_sample_rate}Hz")
            resampler = torchaudio.transforms.Resample(
                orig_freq=sample_rate,
                new_freq=self.target_sample_rate
            )
            waveform = resampler(waveform)
       
        # Normalize audio
        max_val = torch.max(torch.abs(waveform))
        if max_val > 0:
            waveform = waveform / max_val
            logger.info("Audio normalized")
        else:
            logger.warning("Audio appears to be silent (max value is 0)")
        
        result = waveform.squeeze()
        logger.info(f"Preprocessing complete: final shape={result.shape}")
        
        # Ensure we have audio data
        if result.numel() == 0:
            raise ValueError("Processed audio is empty")
            
        return result
   
    def save_temp_audio(self, file_storage) -> str:
        """Save uploaded file to temporary location with proper extension."""
        # Get file extension from original filename
        original_name = getattr(file_storage, 'filename', 'audio.wav')
        file_ext = os.path.splitext(original_name)[1].lower() or '.wav'
        
        # Create temp directory if it doesn't exist
        temp_dir = tempfile.gettempdir()
        os.makedirs(temp_dir, exist_ok=True)
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext, dir=temp_dir) as tmp_file:
            file_storage.save(tmp_file.name)
            logger.info(f"Saved temporary file: {tmp_file.name} (size: {os.path.getsize(tmp_file.name)} bytes)")
            return tmp_file.name
   
    def cleanup_temp_file(self, file_path: str):
        """Remove temporary file."""
        try:
            if os.path.exists(file_path):
                os.unlink(file_path)
                logger.info(f"Cleaned up temporary file: {file_path}")
        except Exception as e:
            logger.warning(f"Could not delete temp file {file_path}: {e}")