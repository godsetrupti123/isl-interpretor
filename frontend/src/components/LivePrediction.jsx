import React from 'react';

const LivePrediction = ({ prediction }) => {
  if (!prediction) {
    return (
      <div className="card" id="card-prediction">
        <h3 className="card-title">Prediction</h3>
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
        <h3 className="card-title">Prediction</h3>
        <div className="prediction-content">
          <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <svg className="spinner" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite', marginBottom: '10px' }}><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
            <p>Analyzing...</p>
          </div>
        </div>
      </div>
    );
  }

  const { label, confidence, top_predictions, status, votes, needed, hands } = prediction;
  const isUncertain = status === 'uncertain';
  const displayLabel = isUncertain ? '?' : label;
  
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
      <h3 className="card-title">Prediction</h3>
      <div className="prediction-content">
        <div className="prediction-result">
          <span className="prediction-label">CURRENT SIGN</span>
          
          <div className="predicted-letter" style={{ color: isUncertain ? 'var(--text-muted)' : 'inherit' }}>
            {displayLabel}
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
               Hold sign steady. Confidence too low.
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
