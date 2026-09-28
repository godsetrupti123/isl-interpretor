"""
FastAPI backend for ISL sign recognition.

The browser runs MediaPipe on the local camera and sends one 126-float
landmark vector per frame over a WebSocket as a raw float32 buffer. This
server applies the trained MLP and the temporal smoothing that turns a
stream of per-frame predictions into committed characters.

MediaPipe's two Hands APIs disagree on left/right handedness for identical
pixels, and this model was trained on legacy mp.solutions.hands output, so
the browser inverts the label it receives from HandLandmarker before
building the vector. See isl-recognition/scripts/parity_check.py.
"""

import logging
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config
from inference.landmarks import InvalidFrameError, decode_frame, is_empty_pose
from inference.model import ModelNotLoadedError, SignClassifier
from inference.smoother import ChargeBuffer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("isl")

classifier = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model once at startup and report clearly if it is missing."""
    global classifier
    log.info("Loading sign classifier...")
    try:
        classifier = SignClassifier().load()
    except ModelNotLoadedError as exc:
        log.error("Could not load the model: %s", exc)
        log.error(
            "Regenerate the artifacts with:\n"
            "  python scripts/export_model.py "
            "--out ../isl-interpretor/backend/model"
        )
        raise

    log.info("Model loaded: %s", classifier.architecture)
    log.info("Classes: %d (%s-%s)",
             classifier.n_classes, classifier.labels[0],
             classifier.labels[-1])
    log.info("Frame size: %d bytes (%d features x float32)",
             config.FRAME_BYTES, config.TOTAL_FEATURES)
    log.info("Smoothing: %d-of-%d frames, confidence gate %.2f",
             config.CHARGE_THRESHOLD, config.CHARGE_BUFFER_SIZE,
             config.CONFIDENCE_THRESHOLD)
    yield
    classifier = None
    log.info("Shutting down.")


app = FastAPI(
    title="ISL Sign Recognition",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LandmarkRequest(BaseModel):
    """
    One landmark vector for the non-streaming upload path.

    A still image produces a single frame, which can never satisfy the
    charge buffer, so POST /predict bypasses smoothing entirely.
    """

    landmarks: list[float] = Field(
        ...,
        min_length=config.TOTAL_FEATURES,
        max_length=config.TOTAL_FEATURES,
        description=f"Exactly {config.TOTAL_FEATURES} floats.",
    )
    label: str | None = Field(
        default=None,
        description="Optional expected label, used only to score accuracy.",
    )


@app.get("/health")
async def health():
    return {
        "status": "ok" if classifier is not None else "degraded",
        "model_loaded": classifier is not None,
        "classes": classifier.n_classes if classifier else 0,
        "features": config.TOTAL_FEATURES,
        "frame_bytes": config.FRAME_BYTES,
    }


@app.websocket("/ws/predict")
async def predict_websocket(websocket: WebSocket):
    """Streams: 504-byte float32 frames in, JSON predictions out."""
    await websocket.accept()

    if classifier is None:
        await websocket.send_json({"error": "Model not loaded"})
        await websocket.close()
        return

    # One buffer per connection, so concurrent clients cannot corrupt each
    # other's smoothing.
    smoother = ChargeBuffer()
    dropped = 0

    log.info("Client connected.")

    try:
        while True:
            try:
                payload = await websocket.receive_bytes()
            except WebSocketDisconnect:
                log.info("Client disconnected after %d dropped frames.",
                         dropped)
                break

            try:
                vector = decode_frame(payload)
            except InvalidFrameError as exc:
                dropped += 1
                await websocket.send_json({
                    "error": f"Invalid frame: {exc}",
                    "dropped": dropped,
                })
                continue

            if is_empty_pose(vector):
                # No hand in frame. Still runs the smoother, which resets it.
                committed = smoother.update(None, 0.0)
                await websocket.send_json({
                    "label": None,
                    "confidence": 0.0,
                    "top_predictions": [],
                    "hands": 0,
                    "state": smoother.state,
                    "committed": committed,
                    "votes": 0,
                    "needed": smoother.threshold,
                })
                continue

            label, confidence, proba = classifier.predict(vector)
            left_present = bool(np.any(np.abs(vector[:63]) > 1e-8))
            right_present = bool(np.any(np.abs(vector[63:]) > 1e-8))

            # A prediction only counts once it clears the confidence gate.
            # Below it we pass None, which resets smoothing.
            gated = label if confidence > smoother.confidence_threshold else None
            committed = smoother.update(gated, confidence)
            votes, needed = smoother.progress

            await websocket.send_json({
                "label": gated,
                "raw_label": label,
                "confidence": round(confidence, 4),
                "top_predictions": classifier.top_k(proba, config.TOP_K),
                "hands": int(left_present) + int(right_present),
                "state": smoother.state,
                "committed": committed,
                "votes": votes,
                "needed": needed,
            })

    except WebSocketDisconnect:
        log.info("Client disconnected after %d dropped frames.", dropped)
    except Exception as exc:  # noqa: BLE001 - never let one socket kill the app
        log.exception("WebSocket error: %s", exc)
        try:
            await websocket.send_json({"error": f"Server error: {exc}"})
        except Exception:  # noqa: BLE001 - socket already gone
            pass
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass  # already closed


@app.post("/predict")
async def predict_once(request: LandmarkRequest):
    """
    Single-shot prediction, used by the image-upload path.

    Smoothing is deliberately bypassed: one frame cannot fill the charge
    buffer, so the stable-character logic the camera path depends on does
    not apply here. Supply `label` to have the response scored against an
    expected answer.
    """
    if classifier is None:
        return {"error": "Model not loaded", "status": "unavailable"}

    try:
        vector = decode_frame(np.asarray(request.landmarks, dtype="<f4")
                              .astype(np.float32).tobytes())
    except InvalidFrameError as exc:
        return {"error": f"Invalid landmarks: {exc}", "status": "invalid"}

    if is_empty_pose(vector):
        return {
            "label": None,
            "confidence": 0.0,
            "top_predictions": [],
            "hands": 0,
            "status": "no_hand",
        }

    label, confidence, proba = classifier.predict(vector)
    left_present = bool(np.any(np.abs(vector[:63]) > 1e-8))
    right_present = bool(np.any(np.abs(vector[63:]) > 1e-8))

    result = {
        "label": label,
        "confidence": round(confidence, 4),
        "top_predictions": classifier.top_k(proba, config.TOP_K),
        "hands": int(left_present) + int(right_present),
        "status": "ok",
    }

    if request.label is not None:
        result["expected"] = request.label
        result["correct"] = request.label.lower() == label.lower()

    return result
