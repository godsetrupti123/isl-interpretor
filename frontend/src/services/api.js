/**
 * One-shot HTTP calls to the FastAPI backend.
 *
 * The image-upload path is deliberately not smoothed: a still image produces
 * a single frame, which can never fill the charge buffer the camera path
 * depends on, so `POST /predict` applies the MLP directly.
 */

/**
 * In development the Vite proxy forwards these to FastAPI, keeping the app
 * same-origin. Set VITE_API_URL to point somewhere else.
 */
const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function parseError(response) {
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    if (body?.error) detail = body.error;
    else if (body?.detail) detail = JSON.stringify(body.detail);
  } catch {
    // Non-JSON error body; the status line is the best we have.
  }
  return new Error(detail);
}

export async function fetchHealth() {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) throw await parseError(response);
  return response.json();
}

/**
 * Predict a single landmark vector.
 * @param {number[]|Float32Array} landmarks exactly 126 floats
 */
export async function predictLandmarks(landmarks) {
  const response = await fetch(`${BASE_URL}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ landmarks: Array.from(landmarks) }),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}
