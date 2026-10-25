import React, { useEffect, useState } from 'react';

const VoiceNarratorToggle = ({ enabled, onToggle, onTest }) => {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [hasVoice, setHasVoice] = useState(false);

  useEffect(() => {
    if (!supported) return undefined;

    const refreshVoices = () => setHasVoice(window.speechSynthesis.getVoices().length > 0);
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, [supported]);

  // The app bundles a local Piper voice, so browser-installed voices are
  // optional. The switch remains usable even when getVoices() is empty.
  const available = supported;

  return (
    <div className="voice-narrator-controls">
      <label className="voice-narrator" title={hasVoice ? 'Read confirmed letters aloud' : 'Using the downloaded local voice'}>
        <span className="voice-narrator-label">Voice narrator</span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={!available}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label="Voice narrator"
        />
        <span className="voice-switch" aria-hidden="true"><span /></span>
      </label>
      {!hasVoice && <span className="voice-narrator-status">Downloaded voice ready</span>}
      {available && enabled && (
        <button type="button" className="voice-test-button" onClick={onTest}>
          Test
        </button>
      )}
    </div>
  );
};

const LivePrediction = ({ prediction, voiceEnabled, onVoiceToggle, onVoiceTest }) => {
  if (!prediction) {
    return (
      <div className="card" id="card-prediction">
        <div className="prediction-card-header">
          <h3 className="card-title">Prediction</h3>
          <VoiceNarratorToggle enabled={voiceEnabled} onToggle={onVoiceToggle} onTest={onVoiceTest} />
        </div>
        <div className="prediction-content">
          <div className="empty-state">
            <p>Your prediction will appear here</p>
          </div>
        </div>
      </div>
    );
  }

  if (prediction.loading) {
    return (
      <div className="card" id="card-prediction">
        <div className="prediction-card-header">
          <h3 className="card-title">Prediction</h3>
          <VoiceNarratorToggle enabled={voiceEnabled} onToggle={onVoiceToggle} onTest={onVoiceTest} />
        </div>
        <div className="prediction-content">
          <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <svg className="spinner" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite', marginBottom: '10px' }}><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
            <p>Analyzing...</p>
          </div>
        </div>
      </div>
    );
  }

  const { label, raw_label, confidence, top_predictions, status, votes, needed, hands } = prediction;
  const isUncertain = status === 'uncertain';
  // The backend withholds low-confidence labels from the charge buffer, but
  // still sends its best candidate. Show it as an unconfirmed guess instead
  // of making a detected hand look like no prediction was produced.
  const displayLabel = isUncertain ? (raw_label || '?') : label;
  
  const percentage = Math.round(confidence * 100) || 0;
  
  let confColor = 'var(--danger-text)';
  let barColor = 'var(--danger-text)';
  
  if (percentage >= 80) {
    confColor = 'var(--success)';
    barColor = 'var(--success)';
  } else if (percentage >= 50) {
    confColor = 'var(--warning)';
    barColor = 'var(--warning)';
  }

  // The backend commits a character only once `needed` of its last `needed`
  // frames agree. Surfacing that gives immediate feedback while a sign is
  // being held, instead of the UI going quiet until the letter appears.
  const hasCharge = Number.isInteger(votes) && Number.isInteger(needed) && needed > 0;
  const chargePct = hasCharge ? Math.min(100, (votes / needed) * 100) : 0;

  return (
    <div className="card" id="card-prediction">
      <div className="prediction-card-header">
        <h3 className="card-title">Prediction</h3>
      </div>
      <div className="prediction-content">
        <div className="prediction-result">
          <span className="prediction-label">CURRENT SIGN</span>
          
          <div className="predicted-letter-row">
            <div className="predicted-letter" style={{ color: isUncertain ? 'var(--text-muted)' : 'inherit' }}>
              {displayLabel}
            </div>
            <VoiceNarratorToggle enabled={voiceEnabled} onToggle={onVoiceToggle} onTest={onVoiceTest} />
          </div>

          {typeof hands === 'number' && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '4px 0 0', textAlign: 'center' }}>
              {hands === 0 ? 'No hand detected' : `${hands} hand${hands > 1 ? 's' : ''} detected`}
            </p>
          )}

          {hasCharge && !isUncertain && (
            <div className="confidence-container" style={{ marginTop: '12px' }}>
              <div className="confidence-header">
                <span className="confidence-title">Hold steady</span>
                <span className="confidence-value" style={{ color: 'var(--text-muted)' }}>{votes}/{needed}</span>
              </div>
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${chargePct}%`, backgroundColor: 'var(--text-muted)', transition: 'width 0.1s linear' }}
                ></div>
              </div>
            </div>
          )}

          <div className="confidence-container">
            <div className="confidence-header">
              <span className="confidence-title">Confidence</span>
              <span className="confidence-value" style={{ color: confColor }}>{percentage}%</span>
            </div>
            <div className="progress-bar-bg">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${percentage}%`, backgroundColor: barColor, transition: 'width 0.2s, background-color 0.2s' }}
              ></div>
            </div>
          </div>

          {isUncertain && (
            <p style={{ color: 'var(--warning)', fontSize: '0.85rem', marginTop: '10px', textAlign: 'center' }}>
              {hands === 0
                ? 'No hand detected. Move your hand fully into view.'
                : 'Unconfirmed best guess. Hold the sign steady for confirmation.'}
            </p>
          )}

          {top_predictions && top_predictions.length > 0 && (
            <div style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '15px' }}>
              <span className="prediction-label" style={{ marginBottom: '10px', display: 'block' }}>Top 3 Predictions</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {top_predictions.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <strong>{p.label}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>{Math.round(p.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LivePrediction;
