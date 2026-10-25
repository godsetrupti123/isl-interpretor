const blobs = {};
let worker;

export function generateLocalSpeech({
  phonemizeJsUrl,
  phonemizeWasmUrl,
  phonemizeDataUrl,
  workerUrl,
  modelUrl,
  modelConfigUrl,
  input,
  onnxruntimeUrl,
}) {
  return new Promise(async (resolve, reject) => {
    if (worker) {
      worker.terminate();
    }
    worker = new Worker(workerUrl);
    worker.onerror = (event) => reject(new Error(event.message || 'Local voice worker failed'));

    worker.addEventListener('message', (event) => {
      const data = event.data;
      if (data.kind === 'output') {
        resolve({ file: URL.createObjectURL(data.file) });
      } else if (data.kind === 'stderr') {
        reject(new Error(data.message));
      } else if (data.kind === 'fetch' && data.blob) {
        console.debug('Local voice asset loaded:', data.url, data.blob.size);
        blobs[data.url] = data.blob;
      }
    });

    worker.postMessage({
      kind: 'init',
      input,
      speakerId: 0,
      blobs,
      modelUrl,
      modelConfigUrl,
      piperPhonemizeJsUrl: phonemizeJsUrl,
      piperPhonemizeWasmUrl: phonemizeWasmUrl,
      piperPhonemizeDataUrl: phonemizeDataUrl,
      onnxruntimeUrl,
    });
  });
}
