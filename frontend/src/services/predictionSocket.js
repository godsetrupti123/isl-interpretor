/**
 * WebSocket transport for the live prediction stream.
 *
 * The browser's only job here is transport: send one binary landmark frame
 * per camera frame, and surface whatever the backend decides. The temporal
 * smoothing and the decision to commit a character both live in the backend's
 * per-connection charge buffer, so this class deliberately keeps no history,
 * no cooldown, and no confidence gate of its own. An earlier version had all
 * three, which meant the character was being decided twice.
 */

const RECONNECT_DELAY_MS = 3000;

/**
 * Resolve the socket URL. In development the Vite proxy forwards this to
 * FastAPI, so the default is a same-origin path and no CORS or hardcoded
 * host is needed. Set VITE_WS_URL to point somewhere else.
 */
function resolveUrl() {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/predict`;
}

export class PredictionSocket {
  constructor(onStatusChange, onPrediction) {
    this.url = resolveUrl();
    this.socket = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.closedByUser = false;
    this.onStatusChange = onStatusChange;
    this.onPrediction = onPrediction;
  }

  connect() {
    this.closedByUser = false;
    this.onStatusChange({ state: 'connecting', message: 'Connecting...' });

    try {
      this.socket = new WebSocket(this.url);
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.scheduleReconnect();
      return;
    }

    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      this.isConnected = true;
      this.onStatusChange({ state: 'online', message: 'Backend Connected' });
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.error('Error parsing message:', error);
        return;
      }

      if (data.error) {
        // Malformed frames are expected noise on a busy socket; the backend
        // recovers on its own, so report and keep the stream alive.
        console.warn('Backend frame error:', data.error);
        return;
      }

      this.onPrediction({ ...data, source: 'camera' });
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      this.onStatusChange({
        state: 'offline',
        message: 'Backend Disconnected',
      });
      if (!this.closedByUser) this.scheduleReconnect();
    };

    this.socket.onerror = (error) => {
      // onclose always follows and is where reconnection is handled, so this is
      // not a failure the user needs to act on. Logging it as an error just
      // trains people to ignore the console during normal reconnects.
      console.warn('WebSocket error, waiting for reconnect.', error);
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
  }

  /**
   * Send one 126-float vector as a 504-byte little-endian Float32 buffer.
   * Silently drops when not connected, so a camera loop never blocks on the
   * network.
   */
  sendVector(vector) {
    if (!this.isConnected || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(vector.buffer);
    return true;
  }
}
