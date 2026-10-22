import { clamp } from './math';
import type { Point } from './types';

export type MotionSource = 'sensor' | 'camera' | 'test';
export interface MotionSample {
  strength: number;
  direction: Point;
  source: MotionSource;
  magnitude: number;
  confidence: number;
}
export type InputStatus = {
  state:
    | 'idle'
    | 'requesting'
    | 'connected'
    | 'unavailable'
    | 'denied'
    | 'stale';
  message: string;
};
export type MotionCallback = (sample: MotionSample) => void;
export type StatusCallback = (status: InputStatus) => void;
type Vector3 = { x: number; y: number; z: number };

export function accelerationSample(vector: Vector3): MotionSample {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  const strength = Number.isFinite(magnitude)
    ? clamp((magnitude - 0.18) / 12, 0, 1)
    : 0;
  const planar = Math.hypot(vector.x, vector.y);
  return {
    strength,
    direction:
      planar > 0.1
        ? { x: -vector.x / planar, y: vector.y / planar }
        : { x: 0, y: -Math.sign(vector.z || 1) },
    source: 'sensor',
    magnitude: Number.isFinite(magnitude) ? magnitude : 0,
    confidence: 1,
  };
}

function vector(value: DeviceMotionEventAcceleration | null): Vector3 | null {
  if (!value || value.x == null || value.y == null || value.z == null)
    return null;
  return [value.x, value.y, value.z].every(Number.isFinite)
    ? { x: value.x, y: value.y, z: value.z }
    : null;
}

export async function startDeviceMotion(
  onSample: MotionCallback,
  onStatus: StatusCallback,
  signal: AbortSignal,
) {
  const motion = window.DeviceMotionEvent as
    | (typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> })
    | undefined;
  if (!window.isSecureContext || !motion) {
    onStatus({
      state: 'unavailable',
      message: !window.isSecureContext
        ? '센서는 HTTPS 연결에서 사용할 수 있습니다.'
        : '이 브라우저는 가속도 센서를 제공하지 않습니다. 카메라 감지를 사용해 주세요.',
    });
    return;
  }
  onStatus({
    state: 'requesting',
    message: '브라우저의 센서 사용 권한을 확인 중…',
  });
  try {
    if (
      motion.requestPermission &&
      (await motion.requestPermission()) !== 'granted'
    ) {
      if (!signal.aborted)
        onStatus({
          state: 'denied',
          message: '센서 권한이 허용되지 않았습니다.',
        });
      return;
    }
  } catch {
    if (!signal.aborted)
      onStatus({
        state: 'denied',
        message: '브라우저의 센서 권한을 확인해 주세요.',
      });
    return;
  }
  if (signal.aborted) return;
  let baseline: Vector3 | null = null,
    lastReceived = performance.now(),
    lastSample = 0,
    received = 0,
    connected = false;
  const handler = (event: DeviceMotionEvent) => {
    const linear = vector(event.acceleration),
      gravity = vector(event.accelerationIncludingGravity);
    if (!linear && !gravity) return;
    const now = performance.now();
    lastReceived = now;
    received++;
    if (!connected && received >= 2) {
      connected = true;
      onStatus({
        state: 'connected',
        message: '가속도 값 수신 중 · 노트북을 움직여 반응을 확인해 주세요.',
      });
    }
    let acceleration = linear;
    if (!acceleration && gravity) {
      if (!baseline) baseline = { ...gravity };
      acceleration = {
        x: gravity.x - baseline.x,
        y: gravity.y - baseline.y,
        z: gravity.z - baseline.z,
      };
      for (const axis of ['x', 'y', 'z'] as const)
        baseline[axis] += (gravity[axis] - baseline[axis]) * 0.055;
    }
    if (acceleration && received >= 2 && now - lastSample >= 30) {
      lastSample = now;
      onSample(accelerationSample(acceleration));
    }
  };
  const cleanup = () => {
    window.removeEventListener('devicemotion', handler);
    clearInterval(heartbeat);
  };
  const heartbeat = window.setInterval(() => {
    if (signal.aborted) return;
    if (received < 2 && performance.now() - lastReceived > 4500) {
      cleanup();
      onStatus({
        state: 'unavailable',
        message:
          '가속도 데이터가 제공되지 않습니다. 이 맥북에서는 카메라 감지를 사용해 주세요.',
      });
    } else if (connected && performance.now() - lastReceived > 2000) {
      connected = false;
      onStatus({
        state: 'stale',
        message: '센서 신호가 멈췄습니다. 연결 상태를 확인해 주세요.',
      });
      onSample({ ...accelerationSample({ x: 0, y: 0, z: 0 }), confidence: 0 });
    }
  }, 400);
  window.addEventListener('devicemotion', handler);
  signal.addEventListener('abort', cleanup, { once: true });
  onStatus({
    state: 'requesting',
    message: '실제 가속도 데이터가 들어오는지 확인 중…',
  });
}
