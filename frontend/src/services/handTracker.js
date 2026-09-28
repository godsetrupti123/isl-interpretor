/**
 * Browser-side hand tracking: owns the MediaPipe HandLandmarker lifecycle and
 * turns detections into the 126-float vector the backend expects.
 *
 * The numeric work lives in landmarkVector.js so it can be tested without a
 * browser. The mirroring and handedness inversion defined there are not
 * stylistic choices. The model was trained on landmarks extracted by legacy
 * `mp.solutions.hands` from mirrored frames (see
 * isl-recognition/inference/realtime_predict.py), while this code uses
 * tasks-vision `HandLandmarker`. Those two APIs disagree about left/right for
 * identical pixels, and tasks-vision disagrees with legacy even after you
 * mirror. Both facts were measured, not assumed:
 *
 *   scripts/parity_check.py --sweep
 *     mirror input | invert label | result
 *     -------------+--------------+------------------
 *     False        | False        | 0/1
 *     False        | True         | 0/1
 *     True         | False        | 0/1
 *     True         | True         | 1/1  <- selected
 *
 * One caveat worth stating plainly: that sweep ran on a single gated
 * reference image, so the configuration is well-supported but not
 * exhaustively proven. Re-run the sweep with more real ISL samples before
 * trusting it.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { MIRROR_INPUT } from './landmarkVector';

const NUM_HANDS = 2;
const DETECT_CONF = 0.3;
const TRACK_CONF = 0.3;

const ASSET_BASE = `${import.meta.env.BASE_URL}mediapipe`.replace(/\/{2,}/g, '/');
const WASM_PATH = `${ASSET_BASE}/wasm`;
const MODEL_PATH = `${ASSET_BASE}/hand_landmarker.task`;

/** Canonical 21-landmark bone list, for drawing the overlay. */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const landmarkerCache = new Map();

/**
 * Lazily create a HandLandmarker per running mode.
 *
 * VIDEO and IMAGE modes are separate graphs, so the camera and the upload
 * path cannot share one instance. Failures clear the cache entry so a
 * transient GPU error is not cached forever.
 */
export function getHandLandmarker(runningMode = 'VIDEO') {
  const mode = runningMode === 'IMAGE' ? 'IMAGE' : 'VIDEO';
  if (!landmarkerCache.has(mode)) {
    const created = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const baseOptions = { modelAssetPath: MODEL_PATH };
      const options = (delegate) => ({
        baseOptions: { ...baseOptions, ...(delegate ? { delegate } : {}) },
        runningMode: mode,
        numHands: NUM_HANDS,
        minHandDetectionConfidence: DETECT_CONF,
        minHandPresenceConfidence: DETECT_CONF,
        minTrackingConfidence: TRACK_CONF,
      });

      try {
        return await HandLandmarker.createFromOptions(fileset, options('GPU'));
      } catch (error) {
        // Software fallback for machines where WebGL is unavailable.
        console.warn('GPU delegate unavailable, falling back to CPU.', error);
        return HandLandmarker.createFromOptions(fileset, options(null));
      }
    })();
    created.catch(() => landmarkerCache.delete(mode));
    landmarkerCache.set(mode, created);
  }
  return landmarkerCache.get(mode);
}

/** Map raw tasks-vision output onto `{ landmarks, handedness }` records. */
function toHands(result) {
  const handedness = result.handednesses ?? result.handedness ?? [];
  return (result.landmarks ?? []).map((landmarks, index) => ({
    landmarks,
    handedness: handedness[index]?.[0]?.categoryName ?? 'Right',
    score: handedness[index]?.[0]?.score ?? 0,
  }));
}

/** Draw `source` into `target`, mirrored when the parity sweep says to. */
function drawSource(target, source) {
  const context = target.getContext('2d');
  const { width, height } = target;
  context.clearRect(0, 0, width, height);
  if (MIRROR_INPUT) {
    context.save();
    context.setTransform(-1, 0, 0, 1, width, 0);
    context.drawImage(source, 0, 0, width, height);
    context.restore();
  } else {
    context.drawImage(source, 0, 0, width, height);
  }
}

/**
 * Detect hands in a live video frame.
 *
 * `renderInto` receives the mirrored frame. Detecting on that same canvas
 * means the returned coordinates are already in mirrored space, so the
 * overlay lines up with the mirrored picture the user sees, and the whole
 * pipeline costs a single `drawImage` per frame.
 */
export async function detectVideoFrame(video, timestampMs, renderInto) {
  const landmarker = await getHandLandmarker('VIDEO');
  drawSource(renderInto, video);
  return toHands(landmarker.detectForVideo(renderInto, timestampMs));
}

/**
 * Detect hands in a still image. Draws the mirrored image into `renderInto`
 * first when provided, so callers can show exactly what was analyzed.
 */
export async function detectStillImage(image, renderInto) {
  const landmarker = await getHandLandmarker('IMAGE');
  if (renderInto) drawSource(renderInto, image);
  return toHands(landmarker.detect(image));
}
