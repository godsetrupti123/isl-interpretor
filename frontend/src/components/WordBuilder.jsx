import React, { useEffect, useRef, useState } from 'react';

const getCorrectionSuggestion = (word) => {
  const match = word.match(/^([a-z])\1+([a-z]{3,})$/i);
  return match ? match[2] : null;
};

const WordBuilder = ({ text, setText, voiceEnabled, onVoiceToggle, onSpeakText }) => {
  const [pendingCorrection, setPendingCorrection] = useState(null);
  const dismissedSuggestion = useRef(null);

  useEffect(() => {
    const currentWord = text.split(/\s/).pop();
    const suggestion = currentWord.length >= 5 ? getCorrectionSuggestion(currentWord) : null;
    const suggestionKey = suggestion ? `${currentWord}:${suggestion}` : null;

    if (suggestion && dismissedSuggestion.current !== suggestionKey) {
      setPendingCorrection({ original: currentWord, suggestion });
    } else if (!suggestion) {
      setPendingCorrection(null);
    }
  }, [text]);

  const handleSpace = () => setText(prev => prev + ' ');
  const handleBackspace = () => setText(prev => prev.slice(0, -1));
  const handleClear = () => setText('');

  const acceptCorrection = () => {
    if (!pendingCorrection) return;
    const trailingText = text.match(/\s*$/)?.[0] ?? '';
    const withoutCurrentWord = text.slice(0, text.length - trailingText.length - pendingCorrection.original.length);
    setText(`${withoutCurrentWord}${pendingCorrection.suggestion}${trailingText}`);
    setPendingCorrection(null);
  };

  const dismissCorrection = () => {
    if (pendingCorrection) {
      dismissedSuggestion.current = `${pendingCorrection.original}:${pendingCorrection.suggestion}`;
    }
    setPendingCorrection(null);
  };

  return (
    <div className="card" id="card-text-builder">
      <div className="word-builder-header">
        <h3 className="card-title">Build Your Word</h3>
        <label className="word-voice-toggle">
          <input
            type="checkbox"
            role="switch"
            checked={voiceEnabled}
            onChange={(event) => onVoiceToggle(event.target.checked)}
            aria-label="Enable word voice narrator"
          />
          <span>Voice</span>
        </label>
      </div>
      
      <div className="text-display">
        {text.length > 0 ? (
          <div className="text-content">
            {/* Render non-breaking spaces so they are visible in the DOM layout */}
            {text.replace(/ /g, '\u00A0')}
          </div>
        ) : (
          <div className="text-placeholder">Recognized letters will appear here</div>
        )}
      </div>

      {pendingCorrection && (
        <div className="correction-suggestion" role="status">
          <div>
            <strong>Did you mean “{pendingCorrection.suggestion}”?</strong>
            <span>We found a possible correction for “{pendingCorrection.original}”.</span>
          </div>
          <div className="correction-actions">
            <button className="btn btn-primary btn-sm" onClick={acceptCorrection}>Yes, correct</button>
            <button className="btn btn-secondary btn-sm" onClick={dismissCorrection}>Keep it</button>
          </div>
        </div>
      )}
      
      <div className="text-controls">
        <button className="btn btn-secondary btn-sm" onClick={handleSpace} aria-label="Add space">SPACE</button>
        <button className="btn btn-secondary btn-sm" onClick={handleBackspace} aria-label="Backspace">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
        </button>
        <button className="btn btn-danger btn-sm" onClick={handleClear} aria-label="Clear text">CLEAR</button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => onSpeakText(text)}
          disabled={!voiceEnabled || !text.trim()}
          aria-label="Read built word aloud"
        >
          READ ALOUD
        </button>
      </div>
      
      <div className="char-count">
        <span>{text.length}</span> characters
      </div>
    </div>
  );
};

export default WordBuilder;
