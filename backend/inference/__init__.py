"""
Inference package for the ISL sign recognition backend.

Responsibilities are split so the WebSocket layer stays thin:

  landmarks  decode and validate the 126-float frames from the browser
  model      numpy forward pass over the exported weights
  smoother   temporal charge-buffer state machine, one per connection

MediaPipe itself runs in the browser (see frontend/src/services/handTracker.js),
so nothing here needs opencv or mediapipe.
"""
