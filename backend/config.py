"""
Configuration for the ISL sign recognition backend.

Every value can be overridden with an environment variable, so the
thresholds the model was tuned with can be changed without touching code.
Defaults mirror inference/realtime_predict.py in the sibling
isl-recognition project.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

MODEL_DIR = Path(os.getenv("ISL_MODEL_DIR", BASE_DIR / "model"))
WEIGHTS_PATH = Path(os.getenv("ISL_WEIGHTS", MODEL_DIR / "isl_mlp.npz"))
LABELS_PATH = Path(os.getenv("ISL_LABELS", MODEL_DIR / "labels.json"))

# Feature vector layout. Must match the trained model: 21 landmarks x 3
# coords x 2 hands.
NUM_LANDMARKS = 21
FEATURES_PER_HAND = NUM_LANDMARKS * 3
TOTAL_FEATURES = FEATURES_PER_HAND * 2

# One frame is TOTAL_FEATURES float32 values.
FRAME_BYTES = TOTAL_FEATURES * 4

# Below this softmax confidence a frame is treated as "no sign" and resets
# the charge buffer. realtime_predict.py uses 0.7.
CONFIDENCE_THRESHOLD = float(os.getenv("ISL_CONFIDENCE", "0.7"))

# Temporal smoothing, ported from realtime_predict.py. A character is only
# committed once CHARGE_THRESHOLD of the last CHARGE_BUFFER_SIZE frames
# agree on it.
CHARGE_BUFFER_SIZE = int(os.getenv("ISL_CHARGE_BUFFER", "10"))
CHARGE_THRESHOLD = int(os.getenv("ISL_CHARGE_THRESHOLD", "8"))

# How many alternatives to report for the live prediction panel.
TOP_K = int(os.getenv("ISL_TOP_K", "3"))

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ISL_ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
