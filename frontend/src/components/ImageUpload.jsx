import React, { useRef, useState } from 'react';
import { detectStillImage } from '../services/handTracker';
import { buildVector, isEmptyVector } from '../services/landmarkVector';
import { predictLandmarks } from '../services/api';

/**
 * Image upload path.
 *
 * MediaPipe runs in the browser here too, so the backend only ever receives
 * the same 126-float vector the camera sends. It goes over `POST /predict`,
 * not the WebSocket, because a still image yields exactly one frame and the
 * backend's charge buffer needs 8 agreeing frames before it will commit a
 * character. Asking it to smooth a single frame would always report nothing.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ImageUpload = ({ onResult, onError }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);

  const handleFile = (selectedFile) => {
    setError(null);
    if (!VALID_TYPES.includes(selectedFile.type)) {
      setError('Please select a valid image file (JPEG, PNG, WEBP).');
      return;
    }
    if (selectedFile.size > MAX_FILE_BYTES) {
      setError('Image is too large. Please select an image under 5MB.');
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (event) => setPreview(event.target.result);
    reader.readAsDataURL(selectedFile);
  };

  const handleRemove = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** Decode the file into a detached <img> the detector can read. */
  const loadImageElement = (url) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode the image.'));
      image.src = url;
    });

  const handlePredict = async () => {
    if (!file || !preview) return;
    setError(null);
    setIsPredicting(true);
    setIsAnalysing(true);

    try {
      const image = await loadImageElement(preview);
      imageRef.current = image;

      // Show exactly the pixels that were analysed, mirroring included.
      const canvas = canvasRef.current;
      const maxWidth = 480;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);

      const hands = await detectStillImage(image, canvas);

      if (hands.length === 0) {
        onError?.('No hand detected in that image.');
        setError('No hand detected. Try a clearer image of a hand sign.');
        return;
      }

      const vector = buildVector(hands);
      if (isEmptyVector(vector)) {
        onError?.('Hand landmarks were empty.');
        setError('Could not read hand landmarks from that image.');
        return;
      }

      const data = await predictLandmarks(vector);
      onResult?.({ ...data, source: 'upload' });
    } catch (err) {
      console.error('Prediction error:', err);
      setError(err.message || 'Prediction failed. Make sure the backend is running.');
      onError?.(err.message);
    } finally {
      setIsPredicting(false);
      setIsAnalysing(false);
    }
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
          <svg className="upload-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
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
          <canvas
            ref={canvasRef}
            style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }}
          />
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
          disabled={!file || isPredicting}
          onClick={handlePredict}
        >
          {isAnalysing ? 'Analysing...' : isPredicting ? 'Predicting...' : 'Predict Image'}
        </button>
        {error && <p className="error-message">{error}</p>}
      </div>
    </div>
  );
};

export default ImageUpload;
