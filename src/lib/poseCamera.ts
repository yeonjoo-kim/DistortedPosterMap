import type { Pose, Results } from '@mediapipe/pose';
import { bodyMotion } from './bodyMotion';
import type { Joint } from './bodyMotion';
import type { MotionCallback, StatusCallback } from './motion';

type PoseWindow = Window & { Pose?: typeof Pose };
let sdk: Promise<typeof Pose> | null = null;
function loadPose() {
  if (!sdk)
    sdk = new Promise<typeof Pose>((resolve, reject) => {
      if ((window as PoseWindow).Pose) {
        resolve((window as PoseWindow).Pose!);
        return;
      }
      const script = document.createElement('script');
      script.src = '/pose/pose.js';
      script.onload = () =>
        (window as PoseWindow).Pose
          ? resolve((window as PoseWindow).Pose!)
          : reject(new Error('몸동작 인식기를 불러오지 못했습니다.'));
      script.onerror = () => {
        script.remove();
        sdk = null;
        reject(
          new Error(
            '몸동작 인식 파일을 불러오지 못했습니다. 다시 연결해 주세요.',
          ),
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
        '몸동작 감지는 HTTPS의 Safari 또는 Chrome에서 사용할 수 있습니다.',
    });
    return;
  }
  onStatus({ state: 'requesting', message: '카메라 권한을 기다리는 중…' });
  let stream: MediaStream | null = null,
    detector: Pose | null = null;
  let stopped = false,
    frame = 0,
    busy = false,
    closePending = false;
  let previous: Joint[] | null = null,
    previousAt = 0,
    lastFrame = -1,
    lastTick = 0,
    lastStatus = 0;
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
        '기기 안에서 몸동작 인식을 준비하는 중… 첫 실행은 잠시 걸릴 수 있습니다.',
    });
    const Constructor = await loadPose();
    if (signal.aborted) {
      cleanup();
      return;
    }
    detector = new Constructor({ locateFile: (file) => `/pose/${file}` });
    detector.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
    detector.onResults((results: Results) => {
      if (stopped) return;
      const now = performance.now();
      const points = results.poseLandmarks ?? [];
      const sample = bodyMotion(previous, points, (now - previousAt) / 1000);
      previous = sample.confidence > 0 ? points.map((p) => ({ ...p })) : null;
      previousAt = now;
      onSample(sample);
      if (now - lastStatus > 800) {
        lastStatus = now;
        onStatus({
          state: 'connected',
          message:
            sample.confidence > 0
              ? '몸동작 감지 중 · 춤이 커질수록 소리와 파괴가 강해집니다.'
              : '사람을 찾는 중 · 어깨와 팔이 보이도록 카메라 앞에 서 주세요.',
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
      message: '몸동작 감지 준비 완료 · 카메라를 고정하고 춤춰 보세요.',
    });
    const tick = async (now: number) => {
      if (stopped || !detector) return;
      if (
        now - lastTick > 80 &&
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
                '몸동작 인식이 중단되었습니다. 브라우저의 그래픽 가속 설정을 확인하고 다시 연결해 주세요.',
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
              message: '카메라 연결이 종료되었습니다.',
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
            ? '카메라 권한이 허용되지 않았습니다. 사이트 권한을 확인하고 다시 시도해 주세요.'
            : '몸동작 인식을 시작하지 못했습니다. 브라우저의 카메라·그래픽 가속을 확인하고 다시 연결해 주세요.',
      });
  }
}
