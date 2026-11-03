import type { Holistic, Results } from '@mediapipe/holistic';
import { bodyMotion } from './body';
import type { BodyFrame } from './body';
import type { MotionCallback, StatusCallback } from './motion';

type HolisticWindow = Window & { Holistic?: typeof Holistic };
let sdk: Promise<typeof Holistic> | null = null;
function loadHolistic() {
  if (!sdk)
    sdk = new Promise<typeof Holistic>((resolve, reject) => {
      if ((window as HolisticWindow).Holistic) {
        resolve((window as HolisticWindow).Holistic!);
        return;
      }
      const script = document.createElement('script');
      script.src = '/tracking/holistic.js';
      script.onload = () =>
        (window as HolisticWindow).Holistic
          ? resolve((window as HolisticWindow).Holistic!)
          : reject(new Error('Unable to load the body node tracker.'));
      script.onerror = () => {
        script.remove();
        sdk = null;
        reject(
          new Error('Unable to load tracking files. Reconnect to try again.'),
        );
      };
      document.head.append(script);
    });
  return sdk;
}

export async function startBodyCamera(
  video: HTMLVideoElement,
  onSample: MotionCallback,
  onStatus: StatusCallback,
  signal: AbortSignal,
) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    onStatus({
      state: 'unavailable',
      message:
        'Body nodes require HTTPS and a modern Safari or Chrome browser.',
    });
    return;
  }
  onStatus({ state: 'requesting', message: 'Waiting for camera permission…' });
  let stream: MediaStream | null = null,
    detector: Holistic | null = null;
  let stopped = false,
    frame = 0,
    busy = false,
    closePending = false;
  let previous: BodyFrame | null = null,
    previousAt = 0,
    lastFrame = -1,
    lastTick = 0,
    lastStatus = 0,
    detectedAt = 0;
  const close = () => {
    if (!detector || busy) {
      closePending = true;
      return;
    }
    const closing = detector;
    detector = null;
    void closing.close().catch(() => {});
  };
  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    close();
  };
  signal.addEventListener('abort', cleanup, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    if (signal.aborted) {
      cleanup();
      return;
    }
    video.srcObject = stream;
    await video.play();
    onStatus({
      state: 'requesting',
      message:
        'Loading body, hand and face nodes locally. First start may take a moment.',
    });
    const Constructor = await loadHolistic();
    if (signal.aborted) {
      cleanup();
      return;
    }
    detector = new Constructor({ locateFile: (file) => `/tracking/${file}` });
    detector.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      enableSegmentation: false,
      refineFaceLandmarks: true,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
    detector.onResults((results: Results) => {
      if (stopped) return;
      const now = performance.now();
      const clone = (points: Results['poseLandmarks']) =>
        (points ?? []).map((point) => ({ ...point }));
      const points: BodyFrame = {
        pose: clone(results.poseLandmarks),
        face: clone(results.faceLandmarks),
        leftHand: clone(results.leftHandLandmarks),
        rightHand: clone(results.rightHandLandmarks),
      };
      const sample = bodyMotion(previous, points, (now - previousAt) / 1000);
      previous = sample.confidence > 0 ? points : null;
      previousAt = now;
      if (sample.confidence > 0 && !detectedAt) detectedAt = now;
      if (!sample.confidence) detectedAt = 0;
      onSample(!detectedAt || now - detectedAt < 800
        ? { ...sample, strength: 0, direction: { x: 0, y: 0 } }
        : sample);
      if (now - lastStatus > 800) {
        lastStatus = now;
        onStatus({
          state: 'connected',
          message:
            sample.confidence > 0
              ? 'Nodes detected. Move to drive the poster.'
              : 'No person detected. Keep your face, hands and body in view.',
        });
      }
    });
    busy = true;
    try {
      await detector.initialize();
    } finally {
      busy = false;
    }
    if (stopped || signal.aborted) {
      cleanup();
      return;
    }
    onStatus({
      state: 'connected',
      message: 'Body nodes ready. Keep the camera fixed and move in view.',
    });
    const tick = async (now: number) => {
      if (stopped || !detector) return;
      if (
        now - lastTick > 120 &&
        video.readyState >= 2 &&
        video.currentTime !== lastFrame
      ) {
        lastTick = now;
        lastFrame = video.currentTime;
        busy = true;
        try {
          await detector.send({ image: video });
        } catch {
          if (!stopped) {
            cleanup();
            onStatus({
              state: 'unavailable',
              message:
                'Node tracking stopped. Check hardware acceleration and reconnect.',
            });
          }
        } finally {
          busy = false;
          if (closePending) close();
        }
      }
      if (!stopped) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    stream.getVideoTracks().forEach((track) =>
      track.addEventListener(
        'ended',
        () => {
          if (!stopped) {
            cleanup();
            onStatus({
              state: 'unavailable',
              message: 'Camera disconnected.',
            });
          }
        },
        { once: true },
      ),
    );
  } catch (error) {
    cleanup();
    if (!signal.aborted)
      onStatus({
        state:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'denied'
            : 'unavailable',
        message:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow access in your browser settings.'
            : 'Unable to start body nodes. Check camera access and hardware acceleration, or choose camera motion.',
      });
  }
}
