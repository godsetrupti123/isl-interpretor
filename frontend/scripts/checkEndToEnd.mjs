/**
 * End-to-end check across the whole chain: build a vector with the browser's
 * code, POST it to the running FastAPI backend, and confirm the backend scores
 * it the same as the float64 vector Python generated.
 *
 * checkVectorParity.mjs proves the browser matches the reference. This proves
 * the value also survives the float32 wire encoding and the HTTP hop, which is
 * a different failure mode: a byte-order or length mistake would pass the
 * offline check and still produce wrong predictions.
 *
 * Requires the backend on ISL_API (default http://127.0.0.1:8000).
 * Run: npm run check:e2e
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  FRAME_BYTES,
  INVERT_HANDEDNESS,
  buildVector,
} from '../src/services/landmarkVector.js';

const API = (process.env.ISL_API ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const CONFIDENCE_TOLERANCE = 1e-3;

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(
    resolve(here, '../src/services/__fixtures__/expectedVectors.json'),
    'utf8',
  ),
).filter((c) => c.invert === INVERT_HANDEDNESS && c.hands.length > 0);

async function post(vector) {
  const response = await fetch(`${API}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ landmarks: Array.from(vector) }),
  });
  if (!response.ok) {
    throw new Error(`POST /predict -> ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json());
  if (!health.model_loaded) {
    throw new Error('Backend reports the model is not loaded.');
  }
  console.log(
    `Backend: ${health.classes} classes, ${health.features} features, ` +
    `${health.frame_bytes} bytes/frame`,
  );

  if (health.frame_bytes !== FRAME_BYTES) {
    throw new Error(
      `Frame size mismatch: backend expects ${health.frame_bytes} bytes, ` +
      `frontend sends ${FRAME_BYTES}.`,
    );
  }

  let failures = 0;
  let worst = 0;

  for (const testCase of cases) {
    const jsVector = buildVector(testCase.hands);
    const pyVector = Float64Array.from(testCase.vector);

    const [fromJs, fromPy] = await Promise.all([
      post(jsVector),
      post(pyVector),
    ]);

    if (fromJs.label !== fromPy.label) {
      console.error(
        `FAIL ${testCase.name}: label ${fromJs.label} from the JS vector vs ` +
        `${fromPy.label} from the Python vector`,
      );
      failures += 1;
      continue;
    }

    const delta = Math.abs(fromJs.confidence - fromPy.confidence);
    worst = Math.max(worst, delta);
    if (delta > CONFIDENCE_TOLERANCE) {
      console.error(
        `FAIL ${testCase.name}: confidence ${fromJs.confidence} vs ` +
        `${fromPy.confidence} (delta ${delta})`,
      );
      failures += 1;
    } else {
      console.log(
        `  ok  ${testCase.name}: ${fromJs.label} ` +
        `(${(fromJs.confidence * 100).toFixed(1)}%, ` +
        `hands=${fromJs.hands}, delta ${delta.toExponential(1)})`,
      );
    }
  }

  if (failures > 0) {
    console.error(`\n${failures}/${cases.length} cases failed.`);
    process.exit(1);
  }

  console.log(
    `\nAll ${cases.length} vectors scored identically over the wire ` +
    `(max confidence delta ${worst.toExponential(2)}).`,
  );
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
