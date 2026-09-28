"""
Decode and validate the landmark frames sent by the browser.

The browser runs MediaPipe locally and sends one 126-float vector per
camera frame as a raw little-endian float32 buffer (504 bytes). This
module turns those bytes into a numpy vector, rejecting anything that
would otherwise propagate into the model as NaN or out-of-range values.
"""

import numpy as np

from config import FEATURES_PER_HAND, FRAME_BYTES, TOTAL_FEATURES

# After wrist-origin subtraction and division by the wrist-to-middle-MCP
# distance, every coordinate is a ratio. Real hands land well inside this,
# so a value far outside it means a malformed frame, not a real hand.
MAX_ABS_FEATURE = 50.0

# The wrist is the origin after normalization, so indices 0-2 and 63-65 of
# a correctly built vector are exactly zero.
WRIST_INDICES = (0, 1, 2, FEATURES_PER_HAND, FEATURES_PER_HAND + 1,
                 FEATURES_PER_HAND + 2)


class InvalidFrameError(ValueError):
    """Raised when a frame cannot be used for inference."""


def decode_frame(payload):
    """
    Decode a binary frame into a float64 feature vector.

    Raises InvalidFrameError with a specific reason, so the WebSocket
    handler can report why a frame was dropped instead of dying on it.
    """
    if not isinstance(payload, (bytes, bytearray, memoryview)):
        raise InvalidFrameError("frame must be binary")

    payload = bytes(payload)
    if len(payload) != FRAME_BYTES:
        raise InvalidFrameError(
            f"expected {FRAME_BYTES} bytes, got {len(payload)}"
        )

    vector = np.frombuffer(payload, dtype="<f4").astype(np.float64)
    if vector.shape != (TOTAL_FEATURES,):
        raise InvalidFrameError(
            f"expected {TOTAL_FEATURES} values, got {vector.shape[0]}"
        )

    if not np.all(np.isfinite(vector)):
        raise InvalidFrameError("frame contains NaN or infinity")

    if np.any(np.abs(vector) > MAX_ABS_FEATURE):
        raise InvalidFrameError(
            f"feature out of range (max abs {np.abs(vector).max():.2f})"
        )

    return vector


def is_empty_pose(vector, epsilon=1e-8):
    """
    True when the vector represents "no hand in frame".

    The browser sends a zero-filled vector when MediaPipe detects nothing,
    and a one-handed pose leaves the other slot at zero. Either way there
    is no sign to predict, which resets the charge buffer.
    """
    return not np.any(np.abs(vector) > epsilon)


def split_slots(vector):
    """Returns (left, right) 63-value blocks, for debugging and overlay."""
    return (
        vector[:FEATURES_PER_HAND],
        vector[FEATURES_PER_HAND:],
    )
