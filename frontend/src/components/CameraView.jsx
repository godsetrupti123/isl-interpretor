import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HAND_CONNECTIONS, detectVideoFrame } from '../services/handTracker';
import { buildVector, effectiveHandedness } from '../services/landmarkVector';

/**
 * Live camera view.
 *
 * The hidden `<video>` is only the capture source. Everything the user sees
 * is the `<canvas>`, because detection has to run on mirrored pixels and the
 * overlay only lines up if it is drawn in that same mirrored space. Detecting
 * on the visible canvas itself keeps this to one `drawImage` per frame.
 *
 * Frame cadence comes from `requestVideoFrameCallback`, which fires once per
 * decoded video frame, capped to 30 FPS. The original 6 FPS interval loop
 * could not keep up with a 30 FPS webcam and made the prediction feel laggy.
 */

const TARGET_FPS = 30;
const MIN_FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

const SLOT_COLORS = {
  Left: '#38bdf8',
  Right: '#f472b6',
};

const CameraView = ({ onVector, onTrackingChange }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const runningRef = useRef(false);
  const handleRef = useRef(null);
  const streamRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const inFlightRef = useRef(false);
  // Cumulative since the camera started, and never reset, so it is a valid
  // monotonic signal that the loop is still advancing.
  const totalFramesRef = useRef(0);
  // Per-FPS-window count, reset once a second.
  const windowFramesRef = useRef(0);
  const windowStartRef = useRef(0);

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fps, setFps] = useState(0);

  const stopStream = useCallback(() => {
    runningRef.current = false;
    if (handleRef.current && videoRef.current?.cancelVideoFrameCallback) {
      videoRef.current.cancelVideoFrameCallback(handleRef.current);
    }
    handleRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsActive(false);
  }, []);

  const drawOverlay = useCallback((context, hands, width, height) => {
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const hand of hands) {
      const color = SLOT_COLORS[effectiveHandedness(hand.handedness)];

      context.strokeStyle = color;
      context.lineWidth = Math.max(2, width / 320);
      context.beginPath();
      for (const [from, to] of HAND_CONNECTIONS) {
        const a = hand.landmarks[from];
        const b = hand.landmarks[to];
        context.moveTo(a.x * width, a.y * height);
        context.lineTo(b.x * width, b.y * height);
      }
      context.stroke();

      context.fillStyle = color;
      const radius = Math.max(3, width / 160);
      for (const landmark of hand.landmarks) {
        context.beginPath();
        context.arc(landmark.x * width, landmark.y * height, radius, 0, Math.PI * 2);
        context.fill();
      }

      // Label each hand with the slot the model actually reads, which is not
      // the raw tasks-vision handedness. See handTracker.js.
      const wrist = hand.landmarks[0];
      context.fillStyle = color;
      context.font = `600 ${Math.max(12, width / 32)}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.fillText(
        effectiveHandedness(hand.handedness).toUpperCase(),
        wrist.x * width,
        wrist.y * height - Math.max(16, height / 18),
      );
    }
  }, []);

  const tick = useCallback(async (now) => {
    if (!runningRef.current) return;

    // Chain the next callback first so a skipped or slow frame does not end
    // the loop.
    const video = videoRef.current;
    if (video?.requestVideoFrameCallback) {
      handleRef.current = video.requestVideoFrameCallback(tick);
    } else {
      handleRef.current = requestAnimationFrame(tick);
    }

    if (!runningRef.current || inFlightRef.current) return;
    if (now - lastFrameAtRef.current < MIN_FRAME_INTERVAL_MS) return;

    const canvas = canvasRef.current;
    if (!canvas || !video || video.videoWidth === 0) return;

    lastFrameAtRef.current = now;
    inFlightRef.current = true;

    try {
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // MediaPipe requires strictly increasing timestamps. Held in its own ref
      // so the FPS throttle above and the timestamp sequence stay independent.
      const timestamp = Math.max(
        Math.round(now),
        lastTimestampRef.current + 1,
      );
      lastTimestampRef.current = timestamp;

      const hands = await detectVideoFrame(video, timestamp, canvas);

      drawOverlay(canvas.getContext('2d'), hands, canvas.width, canvas.height);

      // Frame counter. Exposed as a data attribute so the browser test can
      // prove frames are advancing, since a static scene produces an identical
      // prediction every time and cannot be distinguished from a stalled loop.
      // Kept separate from the per-second FPS count, which is reset below.
      totalFramesRef.current += 1;
      windowFramesRef.current += 1;
      canvas.dataset.frames = String(totalFramesRef.current);

      // Recompute FPS once per second rather than on every frame.
      if (now - windowStartRef.current >= 1000) {
        const elapsed = now - windowStartRef.current;
        setFps(Math.round((windowFramesRef.current * 1000) / elapsed));
        windowStartRef.current = now;
        windowFramesRef.current = 0;
      }

      onTrackingChange?.(hands.length);
      onVector?.(buildVector(hands));
    } catch (err) {
      console.error('Frame processing error:', err);
      setError('Frame processing failed. Check that the backend is running.');
      stopStream();
    } finally {
      inFlightRef.current = false;
    }
  }, [drawOverlay, onTrackingChange, onVector, stopStream]);

  const startCamera = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      runningRef.current = true;
      lastFrameAtRef.current = 0;
      lastTimestampRef.current = 0;
      windowStartRef.current = 0;
      totalFramesRef.current = 0;
      windowFramesRef.current = 0;
      setIsActive(true);
      setFps(0);
      handleRef.current = video.requestVideoFrameCallback
        ? video.requestVideoFrameCallback(tick)
        : requestAnimationFrame(tick);
    } catch (err) {
      console.error('Camera error:', err);
      setError('Camera permission denied or camera unavailable.');
      stopStream();
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => () => stopStream(), [stopStream]);

  return (
    <div className="card" id="card-camera">
      <h3 className="card-title">Live Camera</h3>
      <div
        className="camera-area"
        style={{
          position: 'relative',
          background: '#f5f7f9',
          borderRadius: '8px',
          overflow: 'hidden',
          minHeight: '200px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {error && <div className="error-message" style={{ margin: '20px' }}>{error}</div>}

        {isActive && (
          <canvas
            ref={canvasRef}
            style={{ width: '100%', display: 'block' }}
          />
        )}

        {isActive && (
          <div
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              padding: '3px 8px',
              borderRadius: '999px',
              background: 'rgba(15, 23, 42, 0.72)',
              color: '#e2e8f0',
              fontSize: '0.75rem',
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
            }}
          >
            {fps} FPS
          </div>
        )}

        {!isActive && !error && (
          <div style={{ padding: '20px', color: '#64748b', textAlign: 'center' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px' }}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2 -2V9a2 2 0 0 0 -2 -2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            <p>Camera is currently off</p>
          </div>
        )}

        {/* Capture source only. Kept in the layout at 1px rather than
            display:none, because a fully hidden video can stop decoding
            frames in some browsers, which silently starves the frame loop. */}
        <video
          ref={videoRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none',
            left: 0,
            top: 0,
          }}
          playsInline
          muted
        />
      </div>

      <div className="action-area" style={{ marginTop: '15px' }}>
        {!isActive ? (
          <button className="btn btn-primary btn-full" onClick={startCamera} disabled={isLoading}>
            {isLoading ? 'Starting...' : 'Start Camera'}
          </button>
        ) : (
          <button className="btn btn-danger btn-full" onClick={stopStream}>Stop Camera</button>
        )}
      </div>
    </div>
  );
};

export default CameraView;
