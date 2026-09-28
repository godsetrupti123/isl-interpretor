import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies API and WebSocket traffic to FastAPI so the frontend
// stays same-origin. That keeps CORS out of the picture locally and means the
// app works unchanged when the backend moves to a different port, which
// VITE_API_URL / VITE_WS_URL still allow for anyone who needs it.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/health': 'http://127.0.0.1:8000',
      '/predict': 'http://127.0.0.1:8000',
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
  // The vendored MediaPipe WASM is ~34MB. Leave it out of the dependency
  // pre-bundle so `npm run dev` does not spend a long time re-optimizing.
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
})
