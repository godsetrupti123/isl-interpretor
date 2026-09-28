"""
Temporal smoothing for sign recognition.

A direct port of the charge-buffer state machine from
isl-recognition/inference/realtime_predict.py (lines 188-218), extracted
into a class so each WebSocket connection gets its own instance instead of
sharing module-level mutable state.

The behaviour, preserved exactly:

  IDLE      no hand, or confidence below threshold. Any held sign is
            forgotten and the buffer is emptied.
  CHARGING  a sign has been seen. Once the buffer holds CHARGE_BUFFER_SIZE
            frames, a sign is committed if CHARGE_THRESHOLD of them agree.
  COMMITTED a sign was just committed. Holding the same sign will not
            commit it again; the sign must change first.

That last rule is why the same letter cannot be typed twice in a row by
holding one pose: most_common != committed_label.
"""

from collections import Counter, deque

from config import (
    CHARGE_BUFFER_SIZE,
    CHARGE_THRESHOLD,
    CONFIDENCE_THRESHOLD,
)

IDLE = "IDLE"
CHARGING = "CHARGING"
COMMITTED = "COMMITTED"


class ChargeBuffer:
    def __init__(
        self,
        buffer_size=CHARGE_BUFFER_SIZE,
        threshold=CHARGE_THRESHOLD,
        confidence_threshold=CONFIDENCE_THRESHOLD,
    ):
        if threshold > buffer_size:
            raise ValueError(
                f"threshold ({threshold}) cannot exceed buffer size "
                f"({buffer_size})"
            )
        self.buffer_size = buffer_size
        self.threshold = threshold
        self.confidence_threshold = confidence_threshold

        self._buffer = deque(maxlen=buffer_size)
        self._state = IDLE
        self._committed_label = None

    @property
    def state(self):
        return self._state

    @property
    def committed_label(self):
        return self._committed_label

    @property
    def pending(self):
        """The sign currently leading the buffer, or None."""
        if not self._buffer:
            return None
        return Counter(self._buffer).most_common(1)[0][0]

    @property
    def progress(self):
        """
        How close the buffer is to committing: (votes, needed).

        Lets the UI show progress toward the next character instead of
        committing silently.
        """
        if not self._buffer:
            return 0, self.threshold
        label, votes = Counter(self._buffer).most_common(1)[0]
        if label == self._committed_label:
            return 0, self.threshold
        return votes, self.threshold

    def reset(self):
        self._buffer.clear()
        self._state = IDLE
        self._committed_label = None

    def update(self, label, confidence):
        """
        Feed one frame's result.

        label: the predicted letter, or None when there is no sign to
               predict (no hand, or below the confidence threshold).
        confidence: softmax probability for that label.

        Returns the committed letter if this frame committed one, else None.
        """
        if label is None or confidence <= self.confidence_threshold:
            # A dropped prediction fully resets: the buffer is cleared and
            # the committed label forgotten, so the same sign can be
            # committed again after the hand reappears.
            self._state = IDLE
            self._buffer.clear()
            self._committed_label = None
            return None

        self._buffer.append(label)

        if self._state == IDLE:
            self._state = CHARGING

        committed_now = None

        if self._state == CHARGING and len(self._buffer) == self._buffer.maxlen:
            most_common, count = Counter(self._buffer).most_common(1)[0]
            if count >= self.threshold and most_common != self._committed_label:
                self._committed_label = most_common
                self._state = COMMITTED
                committed_now = most_common

        if self._state == COMMITTED and label != self._committed_label:
            # The sign changed, so a new one can start charging immediately.
            self._state = CHARGING
            self._buffer.clear()
            self._buffer.append(label)

        return committed_now
