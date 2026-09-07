import React from 'react';

const WordBuilder = ({ text, setText }) => {
  const handleSpace = () => setText(prev => prev + ' ');
  const handleBackspace = () => setText(prev => prev.slice(0, -1));
  const handleClear = () => setText('');

  return (
    <div className="card" id="card-text-builder">
      <h3 className="card-title">Build Your Word</h3>
      
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
      
      <div className="text-controls">
        <button className="btn btn-secondary btn-sm" onClick={handleSpace} aria-label="Add space">SPACE</button>
        <button className="btn btn-secondary btn-sm" onClick={handleBackspace} aria-label="Backspace">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
        </button>
        <button className="btn btn-danger btn-sm" onClick={handleClear} aria-label="Clear text">CLEAR</button>
      </div>
      
      <div className="char-count">
        <span>{text.length}</span> characters
      </div>
    </div>
  );
};

export default WordBuilder;
