import React, { useCallback, useEffect, useRef, useState } from 'react';
import './style.css';
import ConnectionStatus from './components/ConnectionStatus';
import ImageUpload from './components/ImageUpload';
import CameraView from './components/CameraView';
import LivePrediction from './components/LivePrediction';
import WordBuilder from './components/WordBuilder';
import { PredictionSocket } from './services/predictionSocket';
import { fetchHealth } from './services/api';

function App() {
  const [backendStatus, setBackendStatus] = useState({
    state: 'connecting',
    message: 'Checking Backend...',
  });
  const [prediction, setPrediction] = useState(null);
  const [recognizedText, setRecognizedText] = useState('');
  const [notice, setNotice] = useState(null);
  const socketRef = useRef(null);

  // Live vector from the camera goes straight to the socket. No buffering
  // here: a slow backend should drop frames, not accumulate a backlog.
  const handleVector = useCallback((vector) => {
    socketRef.current?.sendVector(vector);
  }, []);

  useEffect(() => {
    const socket = new PredictionSocket(
      (status) => setBackendStatus(status),
      (data) => {
        setPrediction({
          ...data,
          // The backend returns a null label when the frame is below the
          // confidence gate; LivePrediction keys its uncertain state off this.
          status: data.label ? 'ok' : 'uncertain',
        });

        // Character commitment is decided entirely by the backend's charge
        // buffer. The frontend must not add its own gating or cooldown.
        if (data.committed) {
          setRecognizedText((previous) => previous + data.committed);
        }
      },
    );
    socketRef.current = socket;
    socket.connect();

    return () => socket.disconnect();
  }, []);

  // Surface the model's readiness separately from socket connectivity, so a
  // live socket with a missing model is not reported as healthy.
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const health = await fetchHealth();
        if (cancelled) return;
        if (!health.model_loaded) {
          setBackendStatus({
            state: 'error',
            message: 'Model not loaded on backend',
          });
        }
      } catch {
        // The socket reports connection state; silence here avoids fighting it.
      }
    };

    check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleUploadResult = useCallback((data) => {
    setNotice(null);
    if (data.status === 'no_hand' || !data.label) {
      setPrediction({ ...data, status: 'uncertain' });
      setNotice('No hand sign was recognised in that image.');
      return;
    }
    setPrediction({ ...data, status: 'ok' });
    setRecognizedText((previous) => previous + data.label);
  }, []);

  const handleUploadError = useCallback((message) => {
    setNotice(message ?? null);
  }, []);

  return (
    <>
      <header className="header">
        <div className="header-container">
          <div className="header-left">
            <div className="title-wrapper">
              <h1>ISL &rarr; English</h1>
              <span className="badge">Real-Time Sign Recognition</span>
            </div>
            <p className="subtitle">Indian Sign Language Fingerspelling</p>
          </div>
          <div className="header-right">
            <ConnectionStatus status={backendStatus} />
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <h2>Turn ISL hand signs into English letters</h2>
          <p>Use your live camera or upload an image to build words letter by letter.</p>
        </section>

        {notice && (
          <div className="card" style={{ padding: '12px 16px' }}>
            <p style={{ margin: 0, color: 'var(--warning)' }}>{notice}</p>
          </div>
        )}

        <section className="workspace">
          <div className="workspace-column-left">
            <CameraView onVector={handleVector} />
            <ImageUpload onResult={handleUploadResult} onError={handleUploadError} />
          </div>

          <div className="workspace-column-right">
            <LivePrediction prediction={prediction} />
            <WordBuilder
              text={recognizedText}
              setText={setRecognizedText}
            />
          </div>
        </section>

        <section className="how-it-works">
          <h3 className="section-title">How It Works</h3>
          <div className="steps-container">
            <div className="step-card">
              <div className="step-number">01</div>
              <h4>Connect</h4>
              <p>Start your camera and ensure the backend is connected.</p>
            </div>
            <div className="step-card">
              <div className="step-number">02</div>
              <h4>Hold Sign</h4>
              <p>Hold a sign steady. A letter is typed only after 8 of the last 10 frames agree on it.</p>
            </div>
            <div className="step-card">
              <div className="step-number">03</div>
              <h4>Build Words</h4>
              <p>Change your sign to type the next letter. Use the Space button for gaps.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>This application recognizes individual static ISL letters using live camera streams and a FastAPI backend.</p>
      </footer>
    </>
  );
}

export default App;
