/**
 * End-to-end browser test in real headless Chrome.
 *
 * This is the only check that exercises the parts the Node scripts cannot:
 * the vendored MediaPipe WASM actually initialising in a browser, the
 * canvas mirroring, the video frame loop, and the WebSocket carrying binary
 * frames from the page. Everything else (vector math, HTTP, streaming) is
 * covered by the cheaper scripts.
 *
 * Two flows are driven:
 *   1. camera  - a fake capture device feeds the frame loop, so the pipeline
 *                runs for real. The fake device shows a synthetic pattern, not
 *                a hand, so the expected outcome is "connected, no hand", not
 *                a specific letter.
 *   2. upload  - a real photograph of a hand goes through the file input, so
 *                MediaPipe must find a hand and the backend must score it.
 *
 * Requires the Vite dev server and the backend to be running.
 * Run: npm run check:browser
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const APP_URL = process.env.ISL_APP ?? 'http://localhost:5173/';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/**
 * A real hand photo that also satisfies the app's own 5MB upload limit.
 * hand_02_right_palm.png is 7.8MB and is correctly rejected by the UI, so it
 * cannot be used here without changing the app's behaviour.
 */
const UPLOAD_IMAGE = resolve(
  root,
  '../../isl-recognition/outputs/parity_samples/hand_00.jpg',
);

/**
 * What the backend fixtures record for UPLOAD_IMAGE. backend/fixtures/
 * sample_poses.json is generated from legacy mp.solutions.hands, so agreeing
 * with it means the whole browser pipeline reproduces the training-time
 * pipeline, not merely that something was returned.
 */
const EXPECTED_UPLOAD_LABEL = 'n';

/**
 * Optional Y4M clip for Chrome's fake capture device. When present, the camera
 * flow is driven with a real hand, so frame flow, streaming, and the charge
 * buffer are all exercised. Generate it with:
 *   isl-recognition/scripts/make_fake_camera_clip.py
 */
const FAKE_CAMERA = resolve(root, '.cache/fake-camera.y4m');

function findBrowser() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No Chrome or Edge found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    );
  }
  return found;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(UPLOAD_IMAGE)) {
    throw new Error(`Upload fixture missing: ${UPLOAD_IMAGE}`);
  }

  const useFakeClip = existsSync(FAKE_CAMERA);
  const cameraArgs = [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (useFakeClip) {
    cameraArgs.push(`--use-file-for-fake-video-capture=${FAKE_CAMERA}`);
  }

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: cameraArgs,
  });
  console.log(
    useFakeClip
      ? `Fake camera: ${FAKE_CAMERA}`
      : 'Fake camera: synthetic pattern (no clip found, hand checks skipped)',
  );

  const failures = [];
  const page = await browser.newPage();

  const consoleErrors = [];
  const notFound = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() === 404) notFound.push(response.url());
  });

  try {
    // --- load -------------------------------------------------------------
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // The WebSocket must reach the backend, otherwise the camera is doing work
    // nobody receives.
    await page.waitForFunction(
      () => document.querySelector('#backend-status')?.className
        .includes('online'),
      { timeout: 20000 },
    ).catch(() => {});

    const connection = await page.evaluate(() => {
      const el = document.querySelector('#backend-status');
      return {
        className: el?.className ?? null,
        text: el?.textContent.trim() ?? null,
      };
    });
    console.log(`Connection: ${JSON.stringify(connection)}`);

    if (!connection.className?.includes('online')) {
      failures.push(
        `WebSocket never connected (status "${connection.text}"). ` +
        'The page cannot reach the backend through the Vite proxy.',
      );
    }

    // --- camera flow ------------------------------------------------------
    const startButton = await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.includes('Start Camera'));
      if (button) return button;
      return false;
    }, { timeout: 20000 }).then((handle) => handle.asElement());

    if (!startButton) throw new Error('Start Camera button never appeared');
    await startButton.click();

    // Give the frame loop time to init MediaPipe, pull frames, and stream.
    await wait(12000);

    const cameraState = await page.evaluate(() => {
      const canvas = document.querySelector('#card-camera canvas');
      const video = document.querySelector('#card-camera video');
      const button = [...document.querySelectorAll('button')]
        .find((b) => /Stop Camera|Starting/.test(b.textContent));
      return {
        hasCanvas: Boolean(canvas),
        canvasWidth: canvas?.width ?? 0,
        canvasHeight: canvas?.height ?? 0,
        videoWidth: video?.videoWidth ?? 0,
        button: button?.textContent.trim() ?? null,
        cameraError: document.querySelector('#card-camera .error-message')
          ?.textContent.trim() ?? null,
      };
    });

    console.log('Camera state:', JSON.stringify(cameraState));

    if (cameraState.cameraError) {
      failures.push(`camera reported an error: ${cameraState.cameraError}`);
    }
    if (!cameraState.hasCanvas) {
      failures.push('no canvas rendered after starting the camera');
    }
    if (cameraState.button && !cameraState.button.includes('Stop')) {
      failures.push(`expected Stop Camera, saw "${cameraState.button}"`);
    }

    // The canvas is only resized from the real video dimensions once frames
    // arrive, so a non-default size proves the loop actually drew something.
    if (cameraState.videoWidth > 0 && cameraState.videoWidth < 16) {
      failures.push(
        `video is ${cameraState.videoWidth}px wide, too small to be a real ` +
        'capture; frame-flow assertions would be meaningless',
      );
    }
    if (useFakeClip) {
      if (cameraState.canvasWidth !== 640 || cameraState.canvasHeight !== 480) {
        failures.push(
          `canvas is ${cameraState.canvasWidth}x${cameraState.canvasHeight}, ` +
          'expected 640x480 from the fake capture clip',
        );
      }
      if (cameraState.videoWidth !== 640) {
        failures.push(
          `video is ${cameraState.videoWidth}px wide, expected 640 from the clip`,
        );
      }

      // With a real hand in frame the browser should be streaming landmarks and
      // the backend should be answering. Whether a given letter clears the 0.7
      // confidence gate is a property of the model, not of this pipeline, and
      // this model is poorly calibrated, so gate clearance is reported rather
      // than asserted. What must hold is that frames keep advancing and hands
      // are found. The frame counter is the reliable signal here: a static
      // scene yields an identical prediction every time, which is
      // indistinguishable from a stalled loop.
      const readLive = () => page.evaluate(() => {
        const card = document.querySelector('#card-prediction');
        const canvas = document.querySelector('#card-camera canvas');
        return {
          label: card?.querySelector('.predicted-letter')?.textContent.trim() ?? null,
          confidence: /Confidence(\d+)%/.exec(card?.textContent ?? '')?.[1] ?? null,
          hands: [...(card?.querySelectorAll('p') ?? [])]
            .map((p) => p.textContent.trim())
            .find((t) => /hand/.test(t)) ?? null,
          frames: Number(canvas?.dataset.frames ?? 0),
        };
      });

      const first = await readLive();
      await wait(3000);
      const second = await readLive();
      console.log(
        `Live prediction: ${JSON.stringify(first)} -> ${JSON.stringify(second)}`,
      );

      if (!first.hands || /0 hand/.test(first.hands)) {
        failures.push(`live path reported no hands (got "${first.hands}")`);
      }
      if (first.confidence === null || Number(first.confidence) <= 0) {
        failures.push('live path produced no confidence score');
      }
      if (second.frames <= first.frames) {
        failures.push(
          `frame counter stalled at ${first.frames}, so the capture loop ` +
          'stopped advancing',
        );
      }
      if (second.fps > 0 && second.fps < 10) {
        failures.push(`tracking only ${second.fps} FPS, expected near 30`);
      }
      console.log(`  tracked ${second.frames - first.frames} frames in 3s`);
      if (first.label === '?') {
        console.log(
          '  note: the fake clip is a cover-cropped hand, which lands below the',
        );
        console.log(
          '        0.7 confidence gate. Expected for this image; the upload',
        );
        console.log('        check below scores the same hand above the gate.');
      }

      // Stop the camera so the live stream does not overwrite the upload
      // result before it can be asserted on.
      const stopButton = await page.evaluateHandle(() =>
        [...document.querySelectorAll('#card-camera button')]
          .find((b) => b.textContent.includes('Stop Camera')) ?? null);
      const stop = stopButton.asElement();
      if (stop) await stop.click();
      await wait(1000);
    }

    // MediaPipe logs its graph creation; a WASM load failure shows up here.
    // favicon.ico is a pre-existing cosmetic 404 and is not a pipeline fault.
    const mediapipeErrors = consoleErrors.filter((text) =>
      /wasm|mediapipe|hand_landmarker|SharedArrayBuffer|WebGL/i.test(text));
    if (mediapipeErrors.length > 0) {
      failures.push(`MediaPipe errors: ${mediapipeErrors.join(' | ')}`);
    }

    // --- upload flow ------------------------------------------------------
    console.log('Uploading a real hand image...');
    const input = await page.$('#card-upload input[type="file"]');
    if (!input) throw new Error('upload file input not found');
    await input.uploadFile(UPLOAD_IMAGE);

    // Give React a beat to run onChange and the FileReader to resolve, then
    // capture the actual state rather than waiting blindly.
    await wait(1500);
    const afterUpload = await page.evaluate(() => {
      const card = document.querySelector('#card-upload');
      return {
        hasCanvas: Boolean(card.querySelector('canvas')),
        hasImg: Boolean(card.querySelector('img')),
        error: card.querySelector('.error-message')?.textContent.trim() ?? null,
        buttons: [...card.querySelectorAll('button')].map((b) => ({
          text: b.textContent.trim(),
          disabled: b.disabled,
        })),
        cardText: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
      };
    });
    console.log('After upload:', JSON.stringify(afterUpload));

    if (afterUpload.error) {
      failures.push(`upload rejected the file: ${afterUpload.error}`);
    }
    if (!afterUpload.hasCanvas) {
      failures.push(
        `upload preview did not render (hasImg=${afterUpload.hasImg})`,
      );
    }

    const predictButton = await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('#card-upload button')]
        .find((b) => b.textContent.includes('Predict'));
      if (button && !button.disabled) return button;
      return false;
    }, { timeout: 20000 }).then((handle) => handle.asElement()).catch(() => null);

    if (!predictButton) {
      failures.push('Predict button never became enabled');
    } else {
      await predictButton.click();
      await wait(15000);
    }

    const uploadState = await page.evaluate(() => {
      const predicted = document.querySelector('#card-prediction .predicted-letter');
      return {
        label: predicted?.textContent.trim() ?? null,
        error: document.querySelector('#card-upload .error-message')
          ?.textContent.trim() ?? null,
        notice: [...document.querySelectorAll('p')]
          .map((p) => p.textContent.trim())
          .find((t) => /No hand|recognised|failed/i.test(t)) ?? null,
        text: document.querySelector('#card-prediction')?.textContent ?? '',
      };
    });

    console.log('Upload state:', JSON.stringify(uploadState));

    if (uploadState.error) {
      failures.push(`upload reported an error: ${uploadState.error}`);
    }
    if (uploadState.notice && /No hand/i.test(uploadState.notice)) {
      failures.push(`upload found no hand: ${uploadState.notice}`);
    }
    if (!uploadState.label) {
      failures.push('upload produced no predicted letter');
    }
    // hand_00.jpg is recorded in the backend fixtures as letter "n". The whole
    // chain must agree: mirrored pixels, inverted handedness, the JS
    // normalization, and the backend model.
    if (uploadState.label && uploadState.label !== EXPECTED_UPLOAD_LABEL) {
      failures.push(
        `upload predicted "${uploadState.label}", expected ` +
        `"${EXPECTED_UPLOAD_LABEL}" for hand_00.jpg`,
      );
    }
  } catch (error) {
    failures.push(error.message);
  } finally {
    if (consoleErrors.length > 0) {
      console.log(`\nConsole errors (${consoleErrors.length}):`);
      for (const text of consoleErrors.slice(0, 20)) console.log(`  - ${text}`);
    }
    if (notFound.length > 0) {
      const real = [...new Set(notFound)].filter((u) => !u.endsWith('/favicon.ico'));
      if (real.length > 0) {
        console.log(`\n404s (${real.length}):`);
        for (const url of real.slice(0, 20)) console.log(`  - ${url}`);
        failures.push(`${real.length} resource(s) 404d`);
      }
    }
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} browser check(s) failed:`);
    for (const text of failures) console.error(`  - ${text}`);
    process.exit(1);
  }

  console.log('\nBrowser checks passed: camera loop and upload both work.');
}

main().catch((error) => {
  console.error(`\n${error.stack ?? error.message}`);
  process.exit(1);
});
