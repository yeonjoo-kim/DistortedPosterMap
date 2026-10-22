import { clamp } from './math';

export function cameraStrength(speed: number, confidence: number) {
  return confidence >= 0.6 && Number.isFinite(speed)
    ? clamp((speed - 2) / 48, 0, 1) ** 0.75
    : 0;
}
import type { MotionCallback, StatusCallback } from './motion';

const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};
export interface OpticalFlow {
  dx: number;
  dy: number;
  rotation: number;
  magnitude: number;
  confidence: number;
  features: number;
}

/** Sparse, brightness-invariant patch matching with a robust global camera-motion fit. */
export function estimateCameraMotion(
  previous: Uint8Array,
  current: Uint8Array,
  width: number,
  height: number,
): OpticalFlow {
  const tracks: { x: number; y: number; dx: number; dy: number }[] = [];
  const radius = 2,
    search = 6,
    margin = 10,
    step = Math.max(10, Math.round(width / 6));
  for (let y = margin; y < height - margin; y += step)
    for (let x = margin; x < width - margin; x += step) {
      let sum = 0,
        sum2 = 0;
      for (let py = -radius; py <= radius; py++)
        for (let px = -radius; px <= radius; px++) {
          const v = previous[(y + py) * width + x + px];
          sum += v;
          sum2 += v * v;
        }
      const count = (radius * 2 + 1) ** 2;
      if (sum2 / count - (sum / count) ** 2 < 140) continue;
      let best = Infinity,
        bx = 0,
        by = 0;
      for (let dy = -search; dy <= search; dy++)
        for (let dx = -search; dx <= search; dx++) {
          let diff = 0,
            diff2 = 0;
          for (let py = -radius; py <= radius; py++)
            for (let px = -radius; px <= radius; px++) {
              const delta =
                previous[(y + py) * width + x + px] -
                current[(y + py + dy) * width + x + px + dx];
              diff += delta;
              diff2 += delta * delta;
            }
          const error =
            (diff2 - (diff * diff) / count) / count +
            (dx * dx + dy * dy) * 0.005;
          if (error < best) {
            best = error;
            bx = dx;
            by = dy;
          }
        }
      if (best < 900)
        tracks.push({ x: x - width / 2, y: y - height / 2, dx: bx, dy: by });
    }
  if (tracks.length < 6)
    return {
      dx: 0,
      dy: 0,
      rotation: 0,
      magnitude: 0,
      confidence: 0,
      features: tracks.length,
    };
  const tx = median(tracks.map((p) => p.dx)),
    ty = median(tracks.map((p) => p.dy));
  const rotation = median(
    tracks
      .filter((p) => p.x * p.x + p.y * p.y > 100)
      .map(
        (p) =>
          (p.x * (p.dy - ty) - p.y * (p.dx - tx)) / (p.x * p.x + p.y * p.y),
      ),
  );
  const dx = median(tracks.map((p) => p.dx + rotation * p.y)),
    dy = median(tracks.map((p) => p.dy - rotation * p.x));
  const inliers = tracks.filter(
    (p) =>
      Math.hypot(p.dx - (dx - rotation * p.y), p.dy - (dy + rotation * p.x)) <=
      1.6,
  );
  const quadrants = new Set(inliers.map((p) => `${p.x >= 0},${p.y >= 0}`));
  const confidence = quadrants.size >= 3 ? inliers.length / tracks.length : 0;
  return {
    dx,
    dy,
    rotation,
    magnitude:
      confidence >= 0.6
        ? Math.hypot(dx, dy) + (Math.abs(rotation) * width) / 2
        : 0,
    confidence,
    features: tracks.length,
  };
}

export async function startCameraMotion(
  video: HTMLVideoElement,
  onSample: MotionCallback,
  onStatus: StatusCallback,
  signal: AbortSignal,
) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    onStatus({
      state: 'unavailable',
      message:
        '카메라는 HTTPS 연결의 Safari 또는 Chrome에서 사용할 수 있습니다.',
    });
    return;
  }
  onStatus({ state: 'requesting', message: '내장 카메라 권한을 기다리는 중…' });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
  } catch (error) {
    if (!signal.aborted)
      onStatus({
        state:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'denied'
            : 'unavailable',
        message:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? '카메라 권한이 허용되지 않았습니다. 브라우저의 사이트 권한을 확인해 주세요.'
            : '사용 가능한 카메라를 찾지 못했습니다.',
      });
    return;
  }
  if (signal.aborted) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  let frame = 0,
    previous: Uint8Array | null = null,
    previousTime = 0,
    lastStatus = 0,
    stopped = false;
  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  signal.addEventListener('abort', cleanup, { once: true });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    cleanup();
    if (!signal.aborted)
      onStatus({
        state: 'unavailable',
        message: '카메라 영상을 시작하지 못했습니다. 다시 연결해 주세요.',
      });
    return;
  }
  if (signal.aborted) {
    cleanup();
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 96;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  onStatus({
    state: 'connected',
    message: '카메라 연결 · 배경의 이동으로 움직임을 추정합니다.',
  });
  const tick = (now: number) => {
    if (stopped) return;
    if (now - previousTime > 65 && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, 128, 96);
      const rgba = ctx.getImageData(0, 0, 128, 96).data,
        gray = new Uint8Array(128 * 96);
      for (let i = 0; i < gray.length; i++)
        gray[i] =
          (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >>
          8;
      if (previous) {
        const flow = estimateCameraMotion(previous, gray, 128, 96);
        const speed =
          flow.magnitude /
          Math.max(0.03, Math.min(0.3, (now - previousTime) / 1000));
        const confidence = flow.confidence;
        onSample({
          source: 'camera',
          strength: cameraStrength(speed, confidence),
          direction: {
            x: -flow.dx / Math.max(1, flow.magnitude),
            y: -flow.dy / Math.max(1, flow.magnitude),
          },
          magnitude: speed,
          confidence,
        });
        if (now - lastStatus > 1100) {
          lastStatus = now;
          onStatus({
            state: 'connected',
            message:
              confidence < 0.6
                ? '배경 추적이 불안정합니다. 밝고 무늬가 있는 정지한 배경을 비춰 주세요.'
                : '카메라 추정 · 노트북과 배경 사이의 상대 움직임',
          });
        }
      }
      previous = gray;
      previousTime = now;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  for (const track of stream.getVideoTracks())
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
    );
}
