from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import os
from pathlib import Path
from inference.predictor import Predictor

app = FastAPI(title="ISL Fingerspelling Backend")

# CORS configuration
origins = [
    "http://localhost:3000",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Predictor instance
predictor = None

@app.on_event("startup")
async def startup_event():
    global predictor
    
    base_dir = Path(__file__).resolve().parent
    model_path = base_dir / "model" / "model.pth"
    classes_path = base_dir / "model" / "classes.json"
    
    print("Loading model...")
    predictor = Predictor(model_path=str(model_path), classes_path=str(classes_path))
    
    print("Model loaded successfully")
    print(f"Device: {predictor.device.type.upper()}")
    print(f"Classes: {len(predictor.classes)}")
    print("Input size: 224x224")

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "model_loaded": predictor is not None,
        "classes": len(predictor.classes) if predictor else 0
    }

@app.websocket("/ws/predict")
async def predict_websocket(websocket: WebSocket):
    await websocket.accept()
    
    if predictor is None:
        await websocket.send_json({"error": "Model not loaded"})
        await websocket.close()
        return

    try:
        while True:
            # 1. Accept binary JPEG/PNG image frames from the React frontend.
            try:
                data = await websocket.receive_bytes()
                
                # Check for empty frames
                if not data:
                    await websocket.send_json({"error": "Empty frame received"})
                    continue
                    
            except WebSocketDisconnect:
                print("Client disconnected")
                break
            except Exception as e:
                print(f"Error receiving data: {e}")
                break

            # 2. Decode, 3. Apply preprocessing, 4. Run inference
            try:
                result = predictor.predict(data)
                await websocket.send_json(result)
            except Exception as e:
                # Handle inference errors without crashing the server
                error_msg = str(e)
                print(f"Prediction error: {error_msg}")
                await websocket.send_json({"error": f"Inference failed: {error_msg}"})
                
    except Exception as e:
        print(f"Unexpected WebSocket error: {e}")
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass # Socket already closed
