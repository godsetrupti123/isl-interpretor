"""
Integration test: starts the real server and drives the real protocol.

    cd backend
    python -m pytest test_server.py -v

Complements test_inference.py (which tests the pieces in isolation) by
covering the wire contract: the 504-byte float32 frame, the JSON response
shape, and the fact that holding a pose commits exactly one character over
a live socket.
"""

import asyncio
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pytest

BACKEND_DIR = Path(__file__).resolve().parent
FIXTURES = BACKEND_DIR / "fixtures" / "sample_poses.json"

pytest.importorskip("websockets")
import websockets  # noqa: E402


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _load_poses():
    if not FIXTURES.exists():
        pytest.skip(f"missing {FIXTURES}")
    with open(FIXTURES, encoding="utf-8") as fh:
        return json.load(fh)["poses"]


class Server:
    def __init__(self, port):
        self.port = port
        self.proc = None

    def __enter__(self):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app",
             "--host", "127.0.0.1", "--port", str(self.port), "--log-level", "warning"],
            cwd=BACKEND_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.time() + 45
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(
                    "server exited early:\n" + (self.proc.stdout.read() or ""))
            try:
                with socket.create_connection(("127.0.0.1", self.port), 0.5):
                    return self
            except OSError:
                time.sleep(0.3)
        raise RuntimeError("server did not start in time")

    def __exit__(self, *exc):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def frame(vector):
    return np.asarray(vector, dtype="<f4").tobytes()


@pytest.fixture(scope="module")
def server():
    with Server(_free_port()) as srv:
        yield srv


def test_health(server):
    import urllib.request

    with urllib.request.urlopen(
            f"http://127.0.0.1:{server.port}/health", timeout=10) as r:
        body = json.loads(r.read())
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert body["classes"] == 26
    assert body["features"] == 126
    assert body["frame_bytes"] == 504


def test_post_predict(server):
    import urllib.request

    poses = _load_poses()
    if not poses:
        pytest.skip("no recorded poses")

    for pose in poses:
        payload = json.dumps({
            "landmarks": pose["landmarks"],
            "label": pose["expected_label"],
        }).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/predict",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())

        assert body["status"] == "ok", body
        assert body["label"] == pose["expected_label"]
        assert body["correct"] is True
        assert len(body["top_predictions"]) == 3


def test_post_predict_rejects_bad_length(server):
    import urllib.request
    from urllib.error import HTTPError

    payload = json.dumps({"landmarks": [0.0] * 100}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{server.port}/predict",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with pytest.raises(HTTPError) as exc:
        urllib.request.urlopen(req, timeout=10)
    assert exc.value.code == 422


@pytest.mark.asyncio
async def test_websocket_commits_exactly_one_character(server):
    pytest.importorskip("pytest_asyncio")
    poses = _load_poses()
    if not poses:
        pytest.skip("no recorded poses")

    pose = poses[0]
    url = f"ws://127.0.0.1:{server.port}/ws/predict"

    async with websockets.connect(url) as ws:
        committed = []
        for _ in range(40):
            await ws.send(frame(pose["landmarks"]))
            body = json.loads(await ws.recv())
            assert "label" in body, body
            assert "confidence" in body, body
            assert "state" in body, body
            assert "top_predictions" in body, body
            if body.get("committed"):
                committed.append(body["committed"])

    assert len(committed) == 1, f"expected 1 character, got {committed}"
    assert committed[0] == pose["expected_label"]


@pytest.mark.asyncio
async def test_websocket_rejects_malformed_frame_without_dying(server):
    """A bad frame must produce an error message, not close the socket."""
    poses = _load_poses()
    if not poses:
        pytest.skip("no recorded poses")

    url = f"ws://127.0.0.1:{server.port}/ws/predict"
    async with websockets.connect(url) as ws:
        await ws.send(b"\x00" * 10)  # wrong length
        body = json.loads(await ws.recv())
        assert "error" in body
        assert "Invalid frame" in body["error"]

        # The socket must still be usable.
        await ws.send(frame(poses[0]["landmarks"]))
        body = json.loads(await ws.recv())
        assert "label" in body


@pytest.mark.asyncio
async def test_websocket_reports_no_hand_for_empty_frame(server):
    url = f"ws://127.0.0.1:{server.port}/ws/predict"
    async with websockets.connect(url) as ws:
        await ws.send(frame(np.zeros(126)))
        body = json.loads(await ws.recv())
        assert body["label"] is None
        assert body["hands"] == 0
        assert body["state"] == "IDLE"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
