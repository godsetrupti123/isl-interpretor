/**
 * Exercise the live streaming path: open the same WebSocket the browser uses,
 * send JS-built binary frames, and confirm the backend's charge buffer commits
 * a character and that the socket survives malformed input.
 *
 * checkEndToEnd.mjs covers the one-shot POST path. This covers the path the
 * camera actually uses, including the behaviour that decides when a letter gets
 * typed, which is owned entirely by the backend.
 *
 * Requires the backend on ISL_API (default http://127.0.0.1:8000).
 * Run: npm run check:ws
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildVector, INVERT_HANDEDNESS } from '../src/services/landmarkVector.js';

const API = (process.env.ISL_API ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const WS_URL = API.replace(/^http/, 'ws') + '/ws/predict';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(
    resolve(here, '../src/services/__fixtures__/expectedVectors.json'),
    'utf8',
  ),
).filter((c) => c.invert === INVERT_HANDEDNESS && c.hands.length > 0);

// A hand the backend scores with high confidence, so the charge buffer can
// realistically reach its threshold within a short burst.
const strong = cases.find(
  (c) => c.name.includes('hand_02') && c.name.includes('both'),
) ?? cases[0];

function openSocket() {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(WS_URL);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => resolvePromise(socket);
    socket.onerror = () => rejectPromise(new Error(`Cannot reach ${WS_URL}`));
  });
}

const nextMessage = (socket) =>
  new Promise((resolvePromise) => {
    socket.onmessage = (event) => resolvePromise(JSON.parse(event.data));
  });

async function main() {
  const socket = await openSocket();
  console.log(`Connected to ${WS_URL}`);

  let failures = 0;
  const vector = buildVector(strong.hands);

  // The charge buffer needs `needed` agreeing frames, so stream enough frames
  // to cross the threshold and let the backend decide.
  const needed = 12;
  let committed = null;
  let lastVotes = null;

  for (let i = 0; i < needed && !committed; i += 1) {
    const reply = nextMessage(socket);
    socket.send(vector.buffer);
    const data = await reply;

    if (data.error) {
      console.error(`FAIL frame ${i}: backend rejected the frame: ${data.error}`);
      failures += 1;
      break;
    }
    lastVotes = { votes: data.votes, needed: data.needed, label: data.label };
    if (data.committed) {
      committed = data.committed;
      console.log(
        `  committed "${data.committed}" on frame ${i + 1} ` +
        `(${data.votes}/${data.needed} votes, label ${data.label})`,
      );
    }
  }

  if (!committed) {
    console.error(
      `FAIL no character committed after ${needed} identical frames ` +
      `(last votes ${JSON.stringify(lastVotes)})`,
    );
    failures += 1;
  }

  // A malformed frame must be reported and survived, not kill the socket.
  const badReply = nextMessage(socket);
  socket.send(new Uint8Array([1, 2, 3]).buffer);
  const bad = await badReply;
  if (!bad.error || bad.dropped !== 1) {
    console.error(`FAIL malformed frame was not rejected cleanly: ${JSON.stringify(bad)}`);
    failures += 1;
  } else {
    console.log(`  malformed frame rejected: "${bad.error}"`);
  }

  // The socket must still work afterwards.
  const recovery = nextMessage(socket);
  socket.send(vector.buffer);
  const recovered = await recovery;
  if (recovered.error) {
    console.error(`FAIL socket unusable after a bad frame: ${recovered.error}`);
    failures += 1;
  } else {
    console.log(`  socket recovered, label ${recovered.label}`);
  }

  socket.close();

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nStreaming path OK: charge buffer commits, bad frames survive.');
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
