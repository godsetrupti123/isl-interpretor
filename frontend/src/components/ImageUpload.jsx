import React, { useRef, useState } from 'react';

const ImageUpload = ({ onPredict }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (selectedFile) => {
    setError(null);
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(selectedFile.type)) {
      setError('Please select a valid image file (JPEG, PNG, WEBP).');
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError('Image is too large. Please select an image under 5MB.');
      return;
    }

    setFile(selectedFile);
    
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(selectedFile);
  };

  const handleRemove = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="card" id="card-upload">
      <h3 className="card-title">Upload an ISL Sign</h3>
      
      {!preview ? (
        <div 
          className={`upload-area ${isDragOver ? 'dragover' : ''}`} 
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
          }}
        >
          <svg className="upload-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p className="upload-text"><strong>Drag & drop your image here</strong></p>
          <p className="upload-subtext">or browse from your device</p>
          <input 
            type="file" 
            ref={fileInputRef} 
            accept="image/jpeg, image/png, image/webp" 
            hidden 
            onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} 
          />
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>Browse Files</button>
        </div>
      ) : (
        <div className="preview-area">
          <img src={preview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }} />
          <div className="file-info">
            <span className="file-name">{file.name}</span>
            <button className="btn-icon" onClick={handleRemove} title="Remove image">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      )}

      <div className="action-area" style={{ marginTop: '15px' }}>
        <button 
           className="btn btn-primary btn-full" 
           disabled={!file} 
           onClick={() => onPredict(file)}
        >
          Predict Image
        </button>
        {error && <p className="error-message">{error}</p>}
      </div>
    </div>
  );
};

export default ImageUpload;
