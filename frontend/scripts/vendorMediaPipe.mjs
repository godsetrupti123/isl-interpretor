/**
 * Vendor the MediaPipe runtime into public/ so the app runs offline, with no
 * CDN and no network access at startup.
 *
 * The WASM runtime is copied from the installed npm package. The model bundle
 * is not published on npm, so it is taken from the sibling isl-recognition
 * project when present and downloaded from Google's public bucket otherwise.
 *
 * These files are gitignored rather than committed: together they are ~46MB of
 * build-time input, and `npm install` runs this automatically, so a fresh clone
 * works without a 46MB blob in history. See postinstall in package.json.
 *
 * Run: npm run vendor
 */

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const MODEL_NAME = 'hand_landmarker.task';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const sourceWasm = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const targetRoot = resolve(root, 'public/mediapipe');
const targetWasm = resolve(targetRoot, 'wasm');
const targetModel = resolve(targetRoot, MODEL_NAME);

/** The copy the parity sweep in isl-recognition validated, when available. */
const siblingModel = resolve(
  root,
  `../../isl-recognition/outputs/cache/${MODEL_NAME}`,
);

async function vendorModel() {
  if (existsSync(targetModel) && statSync(targetModel).size > 0) {
    console.log(`  model  already present (${MODEL_NAME})`);
    return;
  }

  if (existsSync(siblingModel)) {
    copyFileSync(siblingModel, targetModel);
    console.log(`  model  copied from isl-recognition (${MODEL_NAME})`);
    return;
  }

  console.log(`  model  downloading from ${MODEL_URL}`);
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}. ` +
      `Place ${MODEL_NAME} in public/mediapipe/ manually, or run ` +
      'isl-recognition/scripts/parity_check.py to fetch it.',
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(targetModel, buffer);
  console.log(`  model  downloaded (${(buffer.length / 1e6).toFixed(1)} MB)`);
}

async function main() {
  if (!existsSync(sourceWasm)) {
    throw new Error(
      `${sourceWasm} is missing. Run "npm install" first.`,
    );
  }

  mkdirSync(targetWasm, { recursive: true });
  console.log('Vendoring MediaPipe into public/mediapipe:');

  for (const file of WASM_FILES) {
    const from = resolve(sourceWasm, file);
    if (!existsSync(from)) throw new Error(`Package file missing: ${from}`);
    copyFileSync(from, resolve(targetWasm, file));
  }
  console.log(`  wasm   ${WASM_FILES.length} file(s) copied`);

  await vendorModel();
  console.log('Done. Verify with: npm run check:assets');
}

main().catch((error) => {
  console.error(`\nVendoring failed: ${error.message}`);
  process.exit(1);
});
