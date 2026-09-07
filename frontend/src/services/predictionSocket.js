export class PredictionSocket {
  constructor(onStatusChange, onPrediction, onCommitChar) {
    this.url = 'ws://localhost:8000/ws/predict';
    this.socket = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    
    // Callbacks
    this.onStatusChange = onStatusChange;
    this.onPrediction = onPrediction;
    this.onCommitChar = onCommitChar;

    // Temporal Stabilization State
    this.STABLE_FRAMES_REQUIRED = 5; // e.g., 5 frames of the same character
    this.COOLDOWN_MS = 800; // ms to wait after committing a character before allowing the same one again
    
    this.history = [];
    this.lastCommittedChar = null;
    this.lastCommitTime = 0;
  }

  connect() {
    this.onStatusChange({ state: 'connecting', message: 'Connecting...' });
    
    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        this.isConnected = true;
        this.onStatusChange({ state: 'online', message: 'Backend Connected' });
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            console.error('Backend error:', data.error);
            return;
          }
          this.handlePrediction(data);
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        this.onStatusChange({ state: 'offline', message: 'Backend Disconnected' });
        this.scheduleReconnect();
      };

      this.socket.onerror = (err) => {
        console.error('WebSocket Error:', err);
        // onclose will be called
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 3000);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
  }

  sendFrame(blob) {
    if (this.isConnected && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(blob);
    }
  }

  handlePrediction(data) {
    // Notify UI of live prediction
    this.onPrediction({
      ...data,
      source: 'camera'
    });

    const currentLabel = data.label; // Can be null if uncertain

    if (!currentLabel) {
      this.history = []; // Clear history if uncertain
      return;
    }

    // Add to history
    this.history.push(currentLabel);
    
    // Keep only the last N frames
    if (this.history.length > this.STABLE_FRAMES_REQUIRED) {
      this.history.shift();
    }

    // Check stability (are all elements in history the same?)
    const isStable = this.history.length === this.STABLE_FRAMES_REQUIRED && 
                     this.history.every(val => val === currentLabel);

    if (isStable) {
      const now = Date.now();
      
      // If it's a new character, or cooldown has passed for the SAME character
      if (currentLabel !== this.lastCommittedChar || (now - this.lastCommitTime > this.COOLDOWN_MS)) {
        this.onCommitChar(currentLabel);
        this.lastCommittedChar = currentLabel;
        this.lastCommitTime = now;
        
        // Clear history to require a full re-stabilization for the next commit
        this.history = [];
      }
    } else if (this.history.length > 0 && currentLabel !== this.history[this.history.length - 2]) {
        // If the sign changed, reset the committed char to allow immediate typing of a new character
        // We only reset if we see a change, this helps when transitioning between different signs quickly
        if(this.lastCommittedChar && currentLabel !== this.lastCommittedChar) {
             this.lastCommittedChar = null; 
        }
    }
  }
}
