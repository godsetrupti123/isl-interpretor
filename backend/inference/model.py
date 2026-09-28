"""
Inference for the ISL letter classifier.

Loads the framework-neutral artifacts produced by
isl-recognition/scripts/export_model.py and runs the forward pass in
numpy. No scikit-learn dependency at runtime.

The exported weights are float64, which reproduces
sklearn's MLPClassifier.predict_proba bit-for-bit (verified over 2000
random feature vectors by the export script's own parity check).
"""

import json
from pathlib import Path

import numpy as np

from config import (
    FEATURES_PER_HAND,
    LABELS_PATH,
    TOTAL_FEATURES,
    WEIGHTS_PATH,
)


class ModelNotLoadedError(RuntimeError):
    """Raised when the weight artifacts are missing or malformed."""


class SignClassifier:
    def __init__(self, weights_path=WEIGHTS_PATH, labels_path=LABELS_PATH):
        self.weights_path = Path(weights_path)
        self.labels_path = Path(labels_path)
        self.labels = []
        self.mean = None
        self.scale = None
        self.weights = []
        self.biases = []
        self.n_features = 0

    def load(self):
        for path in (self.weights_path, self.labels_path):
            if not path.exists():
                raise ModelNotLoadedError(f"Missing artifact: {path}")

        try:
            with np.load(self.weights_path) as data:
                self.mean = data["mean"]
                self.scale = data["scale"]
                n_layers = sum(
                    1 for key in data.files if key.startswith("W"))
                self.weights = [data[f"W{i}"] for i in range(n_layers)]
                self.biases = [data[f"b{i}"] for i in range(n_layers)]
        except (OSError, KeyError, ValueError) as exc:
            raise ModelNotLoadedError(
                f"Cannot read {self.weights_path}: {exc}") from exc

        if not self.weights:
            raise ModelNotLoadedError(
                f"No weight matrices in {self.weights_path}")

        try:
            with open(self.labels_path, encoding="utf-8") as fh:
                self.labels = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            raise ModelNotLoadedError(
                f"Cannot read {self.labels_path}: {exc}") from exc

        self.n_features = int(self.mean.shape[0])

        if self.n_features != TOTAL_FEATURES:
            raise ModelNotLoadedError(
                f"Model expects {self.n_features} features but the protocol "
                f"sends {TOTAL_FEATURES}. Re-run export_model.py."
            )
        if len(self.labels) != self.weights[-1].shape[1]:
            raise ModelNotLoadedError(
                f"{len(self.labels)} labels for "
                f"{self.weights[-1].shape[1]} output classes."
            )
        if self.mean.shape != self.scale.shape:
            raise ModelNotLoadedError("scaler mean/scale shape mismatch")

        # The trained StandardScaler is guaranteed to have non-zero scale by
        # construction, but a corrupted artifact would silently produce inf.
        if not np.all(np.isfinite(self.scale)) or np.any(self.scale == 0):
            raise ModelNotLoadedError("scaler contains a zero or non-finite "
                                      "scale value")

        return self

    def predict_proba(self, vector):
        """
        Probabilities for one feature vector.

        ReLU on every hidden layer, softmax on the output layer. The output
        layer must not be ReLU'd; doing so distorts the softmax.
        """
        x = (np.asarray(vector, dtype=np.float64) - self.mean) / self.scale

        for w, b in zip(self.weights[:-1], self.biases[:-1]):
            x = np.maximum(x @ w + b, 0.0)

        logits = x @ self.weights[-1] + self.biases[-1]
        exp = np.exp(logits - logits.max())
        return exp / exp.sum()

    def predict(self, vector):
        """Returns (label, confidence, probabilities)."""
        proba = self.predict_proba(vector)
        index = int(np.argmax(proba))
        return self.labels[index], float(proba[index]), proba

    def top_k(self, proba, k):
        order = np.argsort(proba)[::-1][:k]
        return [
            {"label": self.labels[int(i)], "confidence": float(proba[i])}
            for i in order
        ]

    @property
    def n_classes(self):
        return len(self.labels)

    @property
    def architecture(self):
        return " -> ".join(
            [str(self.n_features)]
            + [str(w.shape[1]) for w in self.weights]
        )


__all__ = ["SignClassifier", "ModelNotLoadedError", "FEATURES_PER_HAND"]
