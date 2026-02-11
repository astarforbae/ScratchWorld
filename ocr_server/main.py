from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import logging
import argparse
import io
from functools import partial
import cv2
import numpy as np
from PIL import Image
from paddleocr import PaddleOCR

from pydantic import BaseModel
from typing import List, Optional

class OCRElement(BaseModel):
    text: str
    confidence: float
    x: int
    y: int
    width: int
    height: int
    element_type: str = "text"

class OCRResponse(BaseModel):
    success: bool
    elements: List[OCRElement]
    total_elements: int
    error: Optional[str] = None


# Parse command line arguments
def parse_args():
    parser = argparse.ArgumentParser(description="Simple PaddleOCR Server")
    parser.add_argument(
        "--gpu", 
        action="store_true", 
        default=False,
        help="Enable GPU acceleration (default: CPU only)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=9090,
        help="Server port (default: 9090)"
    )
    parser.add_argument(
        "--ocr-max-requests",
        dest="ocr_max_requests",
        type=int,
        default=4,
        help="Maximum concurrent OCR requests (default: 4)"
    )
    return parser.parse_args()

# Parse arguments
args = parse_args()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration from CLI args
USE_GPU = args.gpu
SERVER_PORT = args.port
MAX_CONCURRENT_REQUESTS = args.ocr_max_requests

# Semaphore to limit concurrent requests
request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

# OCR lock to ensure thread safety (PaddleOCR is not thread-safe)
ocr_lock = asyncio.Lock()

# Global OCR instance
ocr_instance = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown"""
    # Startup
    global ocr_instance
    logger.info("Starting PaddleOCR server...")
    logger.info(f"GPU Enabled: {USE_GPU}")
    logger.info(f"Max concurrent requests: {MAX_CONCURRENT_REQUESTS}")
    logger.info(f"Server port: {SERVER_PORT}")
    
    # Initialize PaddleOCR directly (simple and straightforward)
    logger.info("Initializing PaddleOCR...")
    ocr_instance = PaddleOCR(
        lang='en',
        device="gpu" if USE_GPU else "cpu",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False
    )
    logger.info("PaddleOCR server ready!")
    
    yield  # Server is running
    
    # Shutdown (cleanup if needed)
    logger.info("Shutting down PaddleOCR server...")
    ocr_instance = None

app = FastAPI(
    title="Simple PaddleOCR Server", 
    version="1.0.0",
    description="Simple OCR Server using PaddleOCR backend",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)

def _classify_element(text: str) -> str:
    """Simple element classification"""
    text_lower = text.lower().strip()
    
    if any(word in text_lower for word in ['button', 'click', 'ok', 'cancel']):
        return "button"
    elif text_lower.endswith(':'):
        return "label"
    else:
        return "text"

def _preprocess_image(image_array: np.ndarray) -> np.ndarray:
    """Basic image preprocessing optimized for Scratch interface"""
    if len(image_array.shape) == 3:
        # PaddleOCR expects RGB format
        if image_array.shape[2] == 4:  # RGBA
            image_array = cv2.cvtColor(image_array, cv2.COLOR_RGBA2RGB)
        elif image_array.shape[2] == 3:  # Already RGB
            pass
    else:
        # Convert grayscale to RGB
        image_array = cv2.cvtColor(image_array, cv2.COLOR_GRAY2RGB)
    
    # Simple contrast enhancement
    enhanced = cv2.convertScaleAbs(image_array, alpha=1.1, beta=5)
    return enhanced

@app.post("/ocr/detect", response_model=OCRResponse)
async def detect_text(
    file: UploadFile = File(...),
    confidence: float = Form(0.5)
):
    """Detect text elements from uploaded image with concurrent request limiting"""
    # Use semaphore to limit concurrent requests
    async with request_semaphore:
        try:
            # Validate file type
            if not file.content_type or not file.content_type.startswith('image/'):
                raise HTTPException(status_code=400, detail="File must be an image")
            
            # Read image data
            image_data = await file.read()
            
            if len(image_data) == 0:
                raise HTTPException(status_code=400, detail="Empty image file")
            
            # Log request start
            active_requests = MAX_CONCURRENT_REQUESTS - request_semaphore._value
            logger.info(f"Processing PaddleOCR request (active: {active_requests}/{MAX_CONCURRENT_REQUESTS})")
            
            # Convert to numpy array
            image = Image.open(io.BytesIO(image_data))
            image_array = np.array(image)
            
            # Preprocess image
            processed_image = _preprocess_image(image_array)
            
            # Run OCR detection with thread safety
            logger.info(f"PaddleOCR detection with confidence threshold: {confidence}")
            
            # Use OCR lock to ensure thread safety (PaddleOCR is not thread-safe)
            async with ocr_lock:
                loop = asyncio.get_event_loop()
                predict_func = partial(ocr_instance.predict, input=processed_image)
                result = await loop.run_in_executor(None, predict_func)
            
            # Handle the result format
            if result is None:
                return OCRResponse(success=True, elements=[], total_elements=0)
            
            # Extract OCR result from the new format
            if isinstance(result, dict) and 'res' in result:
                ocr_result = result['res']
            elif isinstance(result, list) and len(result) > 0:
                ocr_result = result[0]
                if isinstance(ocr_result, dict) and 'res' in ocr_result:
                    ocr_result = ocr_result['res']
            else:
                ocr_result = result
            
            # Format results
            elements = []
            if (isinstance(ocr_result, dict) and 
                'dt_polys' in ocr_result and 
                'rec_texts' in ocr_result and 
                'rec_scores' in ocr_result):
                
                dt_polys = ocr_result['dt_polys']
                rec_texts = ocr_result['rec_texts']
                rec_scores = ocr_result['rec_scores']
                
                if dt_polys is not None and rec_texts is not None and rec_scores is not None:
                    for bbox, text, conf in zip(dt_polys, rec_texts, rec_scores):
                        if bbox is None or text is None or not text.strip():
                            continue
                        
                        # Convert confidence to float if needed
                        conf_float = float(conf) if hasattr(conf, 'item') else float(conf)
                        
                        if conf_float >= confidence:
                            # Convert bbox to standard format
                            points = np.array(bbox, dtype=np.int32)
                            x_coords = points[:, 0]
                            y_coords = points[:, 1]
                            x, y = int(np.min(x_coords)), int(np.min(y_coords))
                            width = int(np.max(x_coords) - np.min(x_coords))
                            height = int(np.max(y_coords) - np.min(y_coords))
                            
                            element = OCRElement(
                                text=text.strip(),
                                confidence=conf_float,
                                x=x, y=y, width=width, height=height,
                                element_type=_classify_element(text)
                            )
                            elements.append(element)
            
            result = OCRResponse(
                success=True,
                elements=elements,
                total_elements=len(elements)
            )
            
            logger.info(f"PaddleOCR processed image: {len(elements)} elements found")
            return result
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"PaddleOCR processing error: {e}")
            return OCRResponse(
                success=False,
                elements=[],
                total_elements=0,
                error=str(e)
            )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy", 
        "service": "simple-paddleocr-server", 
        "version": "1.0.0",
        "ocr_backend": "PaddleOCR",
        "gpu_enabled": USE_GPU
    }

@app.get("/info")
async def service_info():
    """Get detailed service information"""
    return {
        "service_name": "Simple PaddleOCR Server",
        "version": "1.0.0",
        "ocr_backend": "PaddleOCR",
        "gpu_enabled": USE_GPU,
        "max_concurrent_requests": MAX_CONCURRENT_REQUESTS,
        "server_port": SERVER_PORT
    }

if __name__ == "__main__":
    import uvicorn
    
    # Use the SERVER_PORT from our main argument parsing
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVER_PORT,
        workers=1,
        log_level="info"
    )
