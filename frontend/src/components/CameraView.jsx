import React, { useRef, useState, useEffect } from 'react';

const CameraView = ({ onFrame }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsActive(true);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Camera permission denied or camera unavailable.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (isActive) {
      // Capture 6 frames per second (approx 166ms)
      timerRef.current = setInterval(() => {
        captureFrame();
      }, 166);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive]);

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current || !isActive) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    
    // Set canvas dimensions to match video
    if (canvas.width !== video.videoWidth) {
       canvas.width = video.videoWidth;
       canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob((blob) => {
      if (blob && onFrame) {
        onFrame(blob);
      }
    }, 'image/jpeg', 0.7);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  return (
    <div className="card" id="card-camera">
      <h3 className="card-title">Live Camera</h3>
      <div className="camera-area" style={{ position: 'relative', background: '#f5f7f9', borderRadius: '8px', overflow: 'hidden', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        
        {error && <div className="error-message" style={{ margin: '20px' }}>{error}</div>}
        
        <video 
          ref={videoRef} 
          style={{ width: '100%', display: isActive ? 'block' : 'none', transform: 'scaleX(-1)' }} 
          playsInline 
          muted 
        />
        
        {!isActive && !error && (
            <div style={{ padding: '20px', color: '#64748b', textAlign: 'center' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px' }}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                <p>Camera is currently off</p>
            </div>
        )}
        
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
      
      <div className="action-area" style={{ marginTop: '15px' }}>
        {!isActive ? (
            <button className="btn btn-primary btn-full" onClick={startCamera}>Start Camera</button>
        ) : (
            <button className="btn btn-danger btn-full" onClick={stopCamera}>Stop Camera</button>
        )}
      </div>
    </div>
  );
};

export default CameraView;
