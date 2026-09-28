/**
 * Verify the vendored MediaPipe runtime is complete and unmodified.
 *
 * The browser loads MediaPipe from public/mediapipe rather than a CDN so the
 * app works offline. That trades a network dependency for a staleness risk: a
 * partially copied WASM directory, or a model file that no longer matches the
 * one the parity sweep validated, would fail deep inside the graph with an
 * unhelpful error. Checking the bytes here fails fast and legibly instead.
 *
 * This cannot substitute for running the app in a browser; it only proves the
 * files on disk are the right ones.
 *
 * Run: npm run check:assets
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** Files copied verbatim from the installed package. */
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const packageWasmDir = resolve(
  root,
  'node_modules/@mediapipe/tasks-vision/wasm',
);
const vendoredWasmDir = resolve(root, 'public/mediapipe/wasm');
const vendoredModel = resolve(root, 'public/mediapipe/hand_landmarker.task');

/**
 * The bundle the parity sweep in isl-recognition validated. Note the two
 * `..`: the sibling project sits next to isl-interpretor, not next to its
 * frontend directory.
 */
const sourceModel = resolve(
  root,
  '../../isl-recognition/outputs/cache/hand_landmarker.task',
);

const digest = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const short = (hash) => hash.slice(0, 16);

let failures = 0;

console.log('WASM runtime (vendored vs node_modules):');
for (const file of WASM_FILES) {
  const source = resolve(packageWasmDir, file);
  const vendored = resolve(vendoredWasmDir, file);
  try {
    const sourceHash = digest(source);
    const vendoredHash = digest(vendored);
    if (sourceHash !== vendoredHash) {
      console.error(`  FAIL ${file}: hash mismatch`);
      failures += 1;
    } else {
      const bytes = statSync(vendored).size;
      console.log(
        `  ok   ${file.padEnd(36)} ${String(bytes).padStart(9)} bytes  ` +
        `${short(vendoredHash)}`,
      );
    }
  } catch (error) {
    console.error(`  FAIL ${file}: ${error.message}`);
    failures += 1;
  }
}

console.log('\nModel bundle (vendored vs parity-validated source):');
try {
  const sourceHash = digest(sourceModel);
  const vendoredHash = digest(vendoredModel);
  if (sourceHash !== vendoredHash) {
    console.error('  FAIL hand_landmarker.task: hash mismatch');
    console.error('       The browser would load a different model than the one');
    console.error('       parity_check.py validated.');
    failures += 1;
  } else {
    console.log(
      `  ok   hand_landmarker.task            ` +
      `${String(statSync(vendoredModel).size).padStart(9)} bytes  ` +
      `${short(vendoredHash)}`,
    );
  }
} catch (error) {
  console.error(`  FAIL hand_landmarker.task: ${error.message}`);
  failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} asset check(s) failed.`);
  process.exit(1);
}

console.log('\nAll vendored MediaPipe assets are present and unmodified.');
