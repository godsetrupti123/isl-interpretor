import React, { useState, useEffect, useRef } from 'react';
import './style.css';
import ConnectionStatus from './components/ConnectionStatus';
import ImageUpload from './components/ImageUpload';
import CameraView from './components/CameraView';
import LivePrediction from './components/LivePrediction';
import WordBuilder from './components/WordBuilder';
import { PredictionSocket } from './services/predictionSocket';

function App() {
  const [backendStatus, setBackendStatus] = useState({ state: 'connecting', message: 'Checking Backend...' });
  const [prediction, setPrediction] = useState(null); // { label, confidence, top_predictions, source }
  const [recognizedText, setRecognizedText] = useState("");
  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize WebSocket
    socketRef.current = new PredictionSocket(
      (status) => setBackendStatus(status),
      (pred) => setPrediction(pred),
      (committedChar) => {
        setRecognizedText(prev => prev + committedChar);
      }
    );
    socketRef.current.connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const handleManualPrediction = async (file) => {
    // Uses the existing REST endpoint for manual image uploads
    setPrediction({ loading: true, source: 'upload' });
    
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('http://localhost:8000/predict', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Prediction failed');
        }

        const data = await response.json();
        
        // Emulate structure from WebSocket
        setPrediction({
          label: data.label,
          confidence: data.confidence,
          top_predictions: data.top_predictions,
          source: 'upload'
        });

        if (data.label) {
           setRecognizedText(prev => prev + data.label);
        }
        
    } catch (error) {
        console.error('Prediction error:', error);
        setPrediction(null);
        alert('Prediction failed. Make sure the backend is running.');
    }
  };

  const handleWebcamFrame = (blob) => {
    if (socketRef.current && socketRef.current.isConnected) {
      socketRef.current.sendFrame(blob);
    }
  };

  return (
    <>
      <header className="header">
        <div className="header-container">
          <div className="header-left">
            <div className="title-wrapper">
              <h1>ISL → English</h1>
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

        <section className="workspace">
          <div className="workspace-column-left">
            <CameraView onFrame={handleWebcamFrame} />
            <ImageUpload onPredict={handleManualPrediction} />
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
                    <p>Hold a sign steady. The system waits for stable predictions before typing.</p>
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
        <p>This application recognizes individual static ISL letters and digits using live camera streams and a FastAPI backend.</p>
      </footer>
    </>
  );
}

export default App;
