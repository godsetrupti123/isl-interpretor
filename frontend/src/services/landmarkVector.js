/**
 * Pure landmark math, with no browser or MediaPipe dependencies.
 *
 * Isolated from handTracker.js on purpose: these functions are the contract
 * with the trained model, and they must be runnable under Node so they can be
 * diffed numerically against the Python reference. See
 * frontend/scripts/checkVectorParity.mjs.
 */

const NUM_LANDMARKS = 21;
const FEATURES_PER_HAND = NUM_LANDMARKS * 3;

export const TOTAL_FEATURES = FEATURES_PER_HAND * 2;

/** Backend decodes exactly this many bytes per WebSocket frame. */
export const FRAME_BYTES = TOTAL_FEATURES * 4;

/**
 * Feed mirrored pixels to the detector, matching the reference pipeline.
 * See the sweep table in handTracker.js.
 */
export const MIRROR_INPUT = true;

/**
 * Report tasks-vision handedness with the slots swapped, because the model was
 * trained on legacy `mp.solutions.hands` labels. See handTracker.js.
 */
export const INVERT_HANDEDNESS = true;

/** Mirrors the training-time scale guard in realtime_predict.py. */
const MIN_SCALE = 1e-6;

/**
 * Wrist-relative, middle-finger-scaled landmarks, flattened to 63 floats.
 *
 * Ports `normalize_single_hand` from realtime_predict.py exactly, including
 * the guard's asymmetric behaviour: the reference leaves coordinates untouched
 * when the scale is degenerate, so this must too. Dividing by a fallback value
 * would silently turn a malformed hand into all zeros.
 */
export function normalizeHand(landmarks) {
  const out = new Float64Array(FEATURES_PER_HAND);
  if (!landmarks || landmarks.length < NUM_LANDMARKS) return out;

  const wrist = landmarks[0];
  const xs = new Float64Array(NUM_LANDMARKS);
  const ys = new Float64Array(NUM_LANDMARKS);
  const zs = new Float64Array(NUM_LANDMARKS);

  for (let i = 0; i < NUM_LANDMARKS; i += 1) {
    xs[i] = landmarks[i].x - wrist.x;
    ys[i] = landmarks[i].y - wrist.y;
    zs[i] = landmarks[i].z - wrist.z;
  }

  // Landmark 9 is the middle-finger MCP joint, the reference scale anchor.
  const scale = Math.hypot(xs[9], ys[9], zs[9]);
  const divide = scale > MIN_SCALE;

  for (let i = 0; i < NUM_LANDMARKS; i += 1) {
    out[i * 3] = divide ? xs[i] / scale : xs[i];
    out[i * 3 + 1] = divide ? ys[i] / scale : ys[i];
    out[i * 3 + 2] = divide ? zs[i] / scale : zs[i];
  }
  return out;
}

/**
 * Map a raw tasks-vision handedness label onto the convention the model was
 * trained on. Single source of truth, so the vector builder and the overlay
 * can never disagree about which slot a hand occupies.
 */
export function effectiveHandedness(rawLabel) {
  const label = rawLabel === 'Left' ? 'Left' : 'Right';
  if (!INVERT_HANDEDNESS) return label;
  return label === 'Left' ? 'Right' : 'Left';
}

/**
 * Build the 126-float `[left(63), right(63)]` vector.
 *
 * An unseen slot stays all zeros; the backend reads that as "hand absent" and
 * treats the frame as an empty pose.
 */
export function buildVector(hands) {
  const left = new Float64Array(FEATURES_PER_HAND);
  const right = new Float64Array(FEATURES_PER_HAND);

  for (const hand of hands) {
    const features = normalizeHand(hand.landmarks);
    (effectiveHandedness(hand.handedness) === 'Left' ? left : right)
      .set(features);
  }

  return new Float32Array([...left, ...right]);
}

/** True when no hand contributed any coordinates. */
export function isEmptyVector(vector) {
  return vector.every((value) => value === 0);
}
