# ISL Interpreter 🤟

**Real-time Indian Sign Language (ISL) fingerspelling recognition using computer vision and machine learning.**

ISL Interpreter is a full-stack web application that recognizes individual static ISL letters from a webcam feed or an uploaded image. It combines browser-based hand tracking, a trained neural network, real-time backend communication, and a word-building interface with voice narration.

- **Live demo:** https://isl-interpretor.onrender.com
- **Repository:** https://github.com/godsetrupti123/isl-interpretor

> **Scope:** This is a letter-level recognition prototype, not a complete ISL-to-English sentence translator.

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Technology Stack](#technology-stack)
- [Model Architecture](#model-architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Limitations](#limitations)
- [Future Improvements](#future-improvements)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Features

### Recognition
- **Live webcam recognition:** Detects hands and processes video frames in the browser.
- **Image upload:** Upload a JPEG, PNG, or WebP image to classify a hand sign.
- **Hand landmark visualization:** Displays detected hand landmarks and connections.
- **Prediction confidence:** Displays the predicted letter and alternative predictions.
- **Temporal smoothing:** Requires consistent predictions across multiple frames before committing a letter.

### Text and accessibility
- **Word builder:** Combine recognized letters into text.
- **Text editing:** Add spaces, delete characters, clear the text, and review possible correction suggestions.
- **Voice narration:** Hear recognized letters and built text using browser speech synthesis, with a local Piper-based fallback.
- **Connection status:** Displays backend connectivity and model readiness.

## How It Works

The application separates hand tracking in the browser from model inference on the backend.

```text
                    FRONTEND
                        |
             Webcam or uploaded image
                        |
                        v
               MediaPipe HandLandmarker
                        |
                        v
              Hand landmark extraction
                        |
                        v
          Normalize and flatten landmarks
                        |
              126-feature vector
                        |
            +-----------+-----------+
            |                       |
       Live webcam               Image upload
            |                       |
       WebSocket                HTTP POST
            |                       |
            +-----------+-----------+
                        |
                        v
                     BACKEND
                        |
                        v
             Validate landmark features
                        |
                        v
              NumPy MLP inference
                        |
                        v
              Letter + confidence
                        |
               Live path only:
             temporal smoothing
                        |
                        v
                     FRONTEND
                        |
                        v
              Display and build text
                        |
                        v
                 Voice narration
```

### Landmark processing

MediaPipe detects up to two hands, with 21 landmarks per hand. Each landmark contains three coordinates: x, y, and z.

The frontend normalizes each hand's landmarks relative to the wrist and scales them using the wrist-to-middle-finger-base distance. It then flattens the two hand slots into a 126-value feature vector.

A missing hand is represented by a zero-filled slot. Feature ordering and handedness conventions must remain consistent with those used by the trained model.

### Real-time prediction

The frontend sends each feature vector to the FastAPI backend as a binary WebSocket message. The backend validates the frame, runs inference, and returns the prediction, confidence, alternative predictions, and smoothing state.

By default, a character is committed when **8 of the latest 10 qualifying frames agree**, subject to a confidence threshold of **0.7**. The backend maintains a separate smoothing buffer for each WebSocket connection.

The image-upload path uses HTTP instead. Since a still image produces only one prediction, it bypasses temporal smoothing.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React, JavaScript, Vite |
| Computer vision | MediaPipe Tasks Vision |
| Backend | Python, FastAPI, Uvicorn |
| Model inference | NumPy, multilayer perceptron (MLP) |
| Communication | HTTP, WebSockets |
| Voice narration | Web Speech API, Piper-based local fallback |
| Deployment | Render |

## Model architecture

The backend loads a trained MLP and performs inference using NumPy.

| Component | Details |
|---|---|
| Input | 126 landmark features |
| Hidden layer 1 | 128 neurons |
| Hidden layer 2 | 64 neurons |
| Output | 26 letter classes |
| Hidden activation | ReLU |
| Output probabilities | Softmax |
| Feature scaling | Stored scaler mean and scale |

Model artifacts are stored in `backend/model/`:

- `isl_mlp.npz` — numerical weights, biases, and feature-scaling parameters.
- `labels.json` — class labels in output-index order.

The inference implementation does not require scikit-learn at runtime. The exported parameters are loaded into NumPy arrays and used for the forward pass.

**The architecture describes the model's structure, not its recognition accuracy.** No accuracy percentage is claimed here because a verified, representative evaluation result has not been established.

## Project structure

```text
isl-interpretor/
├── backend/
│   ├── main.py                  # FastAPI application and endpoints
│   ├── config.py                # Model, smoothing, and server settings
│   ├── inference/
│   │   ├── landmarks.py         # Binary frame validation and decoding
│   │   ├── model.py             # NumPy MLP inference
│   │   └── smoother.py          # Temporal prediction smoothing
│   ├── model/
│   │   ├── isl_mlp.npz          # Model parameters
│   │   └── labels.json          # Output class labels
│   ├── requirements.txt         # Runtime dependencies
│   ├── requirements-dev.txt     # Testing dependencies
│   ├── pytest.ini
│   ├── test_inference.py
│   └── test_server.py
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CameraView.jsx
│   │   │   ├── ImageUpload.jsx
│   │   │   ├── LivePrediction.jsx
│   │   │   ├── WordBuilder.jsx
│   │   │   └── ConnectionStatus.jsx
│   │   ├── services/
│   │   │   ├── handTracker.js
│   │   │   ├── landmarkVector.js
│   │   │   ├── predictionSocket.js
│   │   │   ├── api.js
│   │   │   └── localVoice.js
│   │   ├── App.jsx
│   │   └── style.css
│   ├── scripts/
│   ├── public/
│   ├── package.json
│   └── vite.config.js
│
└── README.md
```

MediaPipe runtime files are generated during frontend installation and are intentionally excluded from Git because they are large, reproducible assets.

## Getting started

### Prerequisites

Install:
- Git
- Python compatible with the backend dependencies
- Node.js and npm
- A modern browser with webcam access

### 1. Clone the repository

```bash
git clone https://github.com/godsetrupti123/isl-interpretor.git
cd isl-interpretor
```

### 2. Set up the backend

```bash
cd backend
python -m venv .venv
```

Activate the environment.

**Windows PowerShell**
```powershell
.venv\Scripts\Activate.ps1
```

**Linux/macOS**
```bash
source .venv/bin/activate
```

Install dependencies and start the server from inside `backend/`:

```bash
python -m pip install -r requirements.txt
uvicorn main:app --reload
```

The backend is normally available at `http://127.0.0.1:8000`. Check its health at `http://127.0.0.1:8000/health`.

The server loads the model during startup. If model artifacts are missing or invalid, startup will report an error.

### 3. Set up the frontend

Open a second terminal from the repository root:

```bash
cd frontend
npm ci
npm run dev
```

The `postinstall` script runs `scripts/vendorMediaPipe.mjs`. It copies the MediaPipe WASM runtime from the installed package and obtains `hand_landmarker.task` from the configured local source or Google's public model bucket.

Open the local URL printed by Vite. The development configuration proxies `/health`, `/predict`, and `/ws` to the backend on port 8000.

### 4. Use the application

1. Confirm the backend status shows a successful connection.
2. Allow camera access when prompted.
3. Hold a supported static letter sign steady until it is recognized.
4. Change your hand sign to enter another letter.
5. Use the word builder to insert spaces, edit text, or read the text aloud.
6. Alternatively, upload a clear image containing a hand sign and select **Predict Image**.

## Configuration

Backend configuration is managed through environment variables in `backend/config.py`.

| Variable | Default | Purpose |
|---|---|---|
| `ISL_MODEL_DIR` | `backend/model` | Model artifact directory |
| `ISL_WEIGHTS` | `backend/model/isl_mlp.npz` | Model weights path |
| `ISL_LABELS` | `backend/model/labels.json` | Label file path |
| `ISL_CONFIDENCE` | `0.7` | Minimum confidence threshold |
| `ISL_CHARGE_BUFFER` | `10` | Number of recent frames considered |
| `ISL_CHARGE_THRESHOLD` | `8` | Agreeing frames required to commit |
| `ISL_TOP_K` | `3` | Number of alternative predictions |
| `ISL_ALLOWED_ORIGINS` | Local development origins | Allowed frontend origins |

The frontend supports `VITE_API_URL` and `VITE_WS_URL` for configuring the HTTP API and WebSocket endpoint. In local development, these can be omitted when using the Vite proxy.

For production, configure them to match the deployed backend:

```env
VITE_API_URL=https://your-backend.example.com
VITE_WS_URL=wss://your-backend.example.com/ws/predict
```

Replace the example domain with the actual backend URL. Configure `ISL_ALLOWED_ORIGINS` on the backend to include the exact deployed frontend origin.

## API reference

### `GET /health`

Reports whether the model is loaded and returns basic inference configuration information. Consult the running endpoint for the exact response schema.

### `POST /predict`

Accepts one landmark feature vector and returns a single prediction without temporal smoothing.

Request body:

```json
{
  "landmarks": [0.0, 0.1, 0.2]
}
```

The example is abbreviated. The actual request must contain exactly **126 floating-point values**.

An optional `label` field can be supplied to compare the prediction with an expected label. The response includes prediction information and, when applicable, comparison results.

### `WS /ws/predict`

Accepts binary WebSocket messages containing 126 little-endian float32 values per frame (**504 bytes**). Responses are JSON messages containing prediction and smoothing information, including fields such as:

- `label` — confidence-gated prediction
- `raw_label` — model's unfiltered prediction
- `confidence` — predicted-class probability
- `top_predictions` — highest-scoring classes
- `hands` — number of detected hand slots
- `state` — smoothing state
- `committed` — newly committed character, if any
- `votes` and `needed` — smoothing progress

Invalid frames are reported without terminating the entire prediction loop.

## Testing

### Backend

From `backend/`, install development dependencies and run the test suite:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -v
```

The suite covers inference and server behavior.

### Frontend

From `frontend/`, available checks include:

```bash
npm run check:vectors
npm run check:assets
npm run build
npm run verify
```

Additional scripts may be available for WebSocket and browser checks:

```bash
npm run check:ws
npm run check:browser
npm run check:e2e
```

Some checks require additional runtime setup, a browser, or a running backend. Their presence does not imply that every test has already passed in every environment. Check `frontend/package.json` for the scripts supported by your checkout.

## Limitations

- The classifier targets individual static letters rather than complete ISL words, grammar, or sentences.
- Recognition quality depends on training data, hand pose, lighting, camera angle, and hand visibility.
- Confidence scores are model outputs; they should not be interpreted as calibrated probabilities without evaluation.
- The mirroring and handedness configuration was selected using reference parity checks, but broader testing across different signers and poses is needed.
- A live deployment may experience startup delays or temporary disconnections depending on hosting conditions.
- No verified generalization benchmark is documented here.

## Future improvements

- Evaluate accuracy, precision, recall, and per-letter confusion matrices on independent test data.
- Test across different signers, lighting conditions, camera angles, and devices.
- Expand the dataset and improve handling of ambiguous or low-confidence predictions.
- Explore temporal models for dynamic signs.
- Investigate word-level recognition and continuous ISL interpretation.
- Improve accessibility, automated browser testing, and deployment monitoring.

## Acknowledgements

This project uses [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) for browser-based hand landmark detection.

The model pipeline references the [real-time ISL recognition implementation](https://github.com/nitibudania/real-time-isl-recognition).

Review the licences and attribution requirements of the original implementation and all bundled dependencies before redistributing the project.

## License

No project-specific license is declared in this README. Add a `LICENSE` file if you intend to grant others explicit permission to use, modify, or distribute this repository.

---

*Built to explore computer vision, neural-network inference, real-time communication, and full-stack application development.*
