import React, { useCallback, useEffect, useRef, useState } from 'react';
import './style.css';
import ConnectionStatus from './components/ConnectionStatus';
import ImageUpload from './components/ImageUpload';
import CameraView from './components/CameraView';
import LivePrediction from './components/LivePrediction';
import WordBuilder from './components/WordBuilder';
import { PredictionSocket } from './services/predictionSocket';
import { fetchHealth } from './services/api';
import { generateLocalSpeech } from './services/localVoice';

const LOCAL_VOICE_ASSETS = {
  phonemizeJs: '/tts/piper_phonemize.js',
  phonemizeWasm: '/tts/piper_phonemize.wasm',
  phonemizeData: '/tts/piper_phonemize.data',
  worker: '/tts/worker/piper_worker.js',
  model: '/tts/en_US-libritts_r-medium.onnx',
  modelConfig: '/tts/en_US-libritts_r-medium.onnx.json',
};

function App() {
  const [backendStatus, setBackendStatus] = useState({
    state: 'connecting',
    message: 'Checking Backend...',
  });
  const [prediction, setPrediction] = useState(null);
  const [recognizedText, setRecognizedText] = useState('');
  const [notice, setNotice] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try {
      const saved = window.localStorage.getItem('isl-voice-narrator');
      return saved === null ? true : saved === 'on';
    } catch {
      return true;
    }
  });
  const [wordVoiceEnabled, setWordVoiceEnabled] = useState(() => {
    try {
      const saved = window.localStorage.getItem('isl-word-voice-narrator');
      return saved === null ? true : saved === 'on';
    } catch {
      return true;
    }
  });
  const socketRef = useRef(null);
  const voiceEnabledRef = useRef(voiceEnabled);
  const wordVoiceEnabledRef = useRef(wordVoiceEnabled);
  const localSpeechQueueRef = useRef(Promise.resolve());
  const audioContextRef = useRef(null);

  const speakText = useCallback((text, enabledRef) => {
    if (!enabledRef.current || !text) return;

    // Resume the audio context during the user's toggle/test gesture. This
    // keeps later model-generated audio allowed by autoplay policies.
    if (!audioContextRef.current && typeof window.AudioContext !== 'undefined') {
      audioContextRef.current = new window.AudioContext();
    }
    audioContextRef.current?.resume();

    // Queue confirmed letters so fast detections are not cancelled before the
    // browser has a chance to start speaking them.
    const spokenText = String(text).length === 1 ? String(text).toUpperCase() : String(text);
    const browserVoices = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];

    if (browserVoices.length > 0 && typeof SpeechSynthesisUtterance !== 'undefined') {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.rate = 0.85;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.voice = browserVoices.find((voice) => voice.lang.startsWith('en')) ?? browserVoices[0];
      utterance.onerror = (event) => console.warn('Voice narrator error:', event.error);
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
      return;
    }

    // The downloaded local Piper voice is used when the browser has no native
    // voices, which is common on Linux and in embedded browsers.
    localSpeechQueueRef.current = localSpeechQueueRef.current
      .then(async () => {
        if (!enabledRef.current) return;
        const audioData = await generateLocalSpeech({
          phonemizeJsUrl: LOCAL_VOICE_ASSETS.phonemizeJs,
          phonemizeWasmUrl: LOCAL_VOICE_ASSETS.phonemizeWasm,
          phonemizeDataUrl: LOCAL_VOICE_ASSETS.phonemizeData,
          workerUrl: LOCAL_VOICE_ASSETS.worker,
          modelUrl: LOCAL_VOICE_ASSETS.model,
          modelConfigUrl: LOCAL_VOICE_ASSETS.modelConfig,
          input: spokenText,
          onnxruntimeUrl: '/tts/worker/dist/',
        });
        const audioContext = audioContextRef.current;
        if (audioContext) {
          const audioBuffer = await audioContext.decodeAudioData(
            await (await fetch(audioData.file)).arrayBuffer(),
          );
          await new Promise((resolve) => {
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.onended = resolve;
            source.start();
          });
        } else {
          const audio = new Audio(audioData.file);
          await new Promise((resolve, reject) => {
            audio.onended = resolve;
            audio.onerror = reject;
            audio.play().catch(reject);
          });
        }
        URL.revokeObjectURL(audioData.file);
      })
      .catch((error) => console.error('Local voice narrator error:', error));
  }, []);

  const announceLetter = useCallback((letter) => {
    speakText(letter, voiceEnabledRef);
  }, [speakText]);

  const announceWord = useCallback((word) => {
    speakText(word, wordVoiceEnabledRef);
  }, [speakText]);

  const handleVoiceToggle = useCallback((enabled) => {
    voiceEnabledRef.current = enabled;
    setVoiceEnabled(enabled);
    try {
      window.localStorage.setItem('isl-voice-narrator', enabled ? 'on' : 'off');
    } catch {
      // Preferences are optional; narration still works for this session.
    }
    if (!enabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    } else if (enabled) {
      // This user gesture unlocks speech in browsers that block automatic
      // speech until the user explicitly interacts with the page.
      announceLetter('Voice narrator enabled');
    }
  }, [announceLetter]);

  const handleWordVoiceToggle = useCallback((enabled) => {
    wordVoiceEnabledRef.current = enabled;
    setWordVoiceEnabled(enabled);
    try {
      window.localStorage.setItem('isl-word-voice-narrator', enabled ? 'on' : 'off');
    } catch {
      // Preferences are optional; narration still works for this session.
    }
    if (enabled) announceWord('Word voice narrator enabled');
  }, [announceWord]);

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
          announceLetter(data.committed);
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
    announceLetter(data.label);
  }, [announceLetter]);

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
            <LivePrediction
              prediction={prediction}
              voiceEnabled={voiceEnabled}
              onVoiceToggle={handleVoiceToggle}
              onVoiceTest={() => announceLetter('Voice narrator test')}
            />
            <WordBuilder
              text={recognizedText}
              setText={setRecognizedText}
              voiceEnabled={wordVoiceEnabled}
              onVoiceToggle={handleWordVoiceToggle}
              onSpeakText={announceWord}
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
