import torch
from transformers import WhisperProcessor, WhisperForConditionalGeneration
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class ModelManager:
    def __init__(self, model_name: str, device: str = "cpu"):
        self.model_name = model_name
        self.device = torch.device(device)
        self.processor: Optional[WhisperProcessor] = None
        self.model: Optional[WhisperForConditionalGeneration] = None
        self.is_loaded = False
    
    def load_model(self):
        """Load the Whisper model and processor."""
        if self.is_loaded:
            return
        
        try:
            logger.info(f"Loading model: {self.model_name}")
            logger.info(f"Device: {self.device}")
            
            # Load processor and model
            self.processor = WhisperProcessor.from_pretrained(self.model_name)
            self.model = WhisperForConditionalGeneration.from_pretrained(
                self.model_name,
                torch_dtype=torch.float16 if self.device.type == "cuda" else torch.float32
            )
            
            # Move model to device
            self.model = self.model.to(self.device)
            
            # Set to evaluation mode
            self.model.eval()
            
            self.is_loaded = True
            logger.info("Model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise
    
    def transcribe(self, audio_array: torch.Tensor) -> str:
        """Transcribe audio using the loaded model."""
        if not self.is_loaded:
            raise ValueError("Model not loaded. Call load_model() first.")
        
        try:
            # Prepare inputs
            inputs = self.processor(
                audio_array.numpy(), 
                sampling_rate=16000, 
                return_tensors="pt"
            )
            input_features = inputs.input_features.to(self.device)
            
            # Generate transcription
            with torch.no_grad():
                if self.device.type == "cuda":
                    with torch.cuda.amp.autocast():
                        predicted_ids = self.model.generate(
                            input_features,
                            max_length=448,
                            num_beams=1,
                            do_sample=False
                        )
                else:
                    predicted_ids = self.model.generate(
                        input_features,
                        max_length=448,
                        num_beams=1,
                        do_sample=False
                    )
            
            # Decode transcription
            transcription = self.processor.batch_decode(
                predicted_ids, 
                skip_special_tokens=True
            )[0]
            
            return transcription.strip()
            
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise