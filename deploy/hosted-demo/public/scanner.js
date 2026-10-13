let fallbackPromise;

function loadFallback() {
  if (window.jsQR) return Promise.resolve();
  if (!fallbackPromise) {
    fallbackPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/jsqr.js';
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        fallbackPromise = null;
        reject(new Error('QR decoder could not load. Use the USB scanner or manual trolley ID.'));
      };
      document.head.append(script);
    });
  }
  return fallbackPromise;
}

/** Video never leaves the browser; scans fill the form and never submit movements. */
export class QrScanner {
  constructor(video, onDecode, onError) {
    this.video = video;
    this.onDecode = onDecode;
    this.onError = onError;
    this.generation = 0;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
  }
  async start() {
    this.stop();
    const generation = this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Camera scanning needs HTTPS or localhost. Use the USB scanner or manual ID here.',
      );
    }
    let detector = null;
    if (window.BarcodeDetector) {
      try {
        if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      } catch {
        /* Native detection is optional; the local decoder handles QR. */
      }
    }
    if (!detector) await loadFallback();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    });
    if (this.generation !== generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch (error) {
      this.stop();
      throw error;
    }
    this.video.hidden = false;
    const scanFrame = async () => {
      if (this.generation !== generation) return;
      try {
        if (this.video.readyState >= 2) {
          let value = null;
          if (detector) value = (await detector.detect(this.video))[0]?.rawValue;
          else {
            const scale = Math.min(1, 640 / this.video.videoWidth);
            this.canvas.width = Math.round(this.video.videoWidth * scale);
            this.canvas.height = Math.round(this.video.videoHeight * scale);
            this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            const image = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
            value = window.jsQR(image.data, image.width, image.height, {
              inversionAttempts: 'attemptBoth',
            })?.data;
          }
          if (this.generation !== generation) return;
          if (value && this.onDecode(value)) {
            this.stop();
            return;
          }
        }
      } catch (error) {
        this.stop();
        this.onError(error.message || 'Camera scan failed. Use a USB scanner or manual ID.');
        return;
      }
      if (this.generation === generation) this.timer = setTimeout(scanFrame, 250);
    };
    scanFrame();
  }
  stop() {
    this.generation += 1;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
  }
}
