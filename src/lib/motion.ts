import { clamp } from './math';
import type { Point } from './types';
import type { BodyObservation } from './body';

// Normalized landmark speed (body) or measured acceleration (device sensor).
export const FRACTURE_SPEED_THRESHOLD = 0.8;

export type MotionSource = 'sensor' | 'camera' | 'body' | 'test';
export interface MotionSample {
  strength: number;
  fractureStrength?: number;
  direction: Point;
  source: MotionSource;
  magnitude: number;
  confidence: number;
  body?: BodyObservation;
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
    ? clamp((magnitude - 0.28) / 18, 0, 1)
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
        ? 'Device motion requires HTTPS.'
        : 'This browser does not expose a motion sensor. Choose a camera input.',
    });
    return;
  }
  onStatus({
    state: 'requesting',
    message: 'Checking sensor permission…',
  });
  try {
    if (
      motion.requestPermission &&
      (await motion.requestPermission()) !== 'granted'
    ) {
      if (!signal.aborted)
        onStatus({
          state: 'denied',
          message: 'Sensor permission denied.',
        });
      return;
    }
  } catch {
    if (!signal.aborted)
      onStatus({
        state: 'denied',
        message: 'Check sensor access in your browser settings.',
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
        message: 'Receiving acceleration. Move the device to perform.',
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
          'No acceleration data is available. Choose body nodes or camera motion.',
      });
    } else if (connected && performance.now() - lastReceived > 2000) {
      connected = false;
      onStatus({
        state: 'stale',
        message: 'Sensor signal stopped. Check the connection.',
      });
      onSample({ ...accelerationSample({ x: 0, y: 0, z: 0 }), confidence: 0 });
    }
  }, 400);
  window.addEventListener('devicemotion', handler);
  signal.addEventListener('abort', cleanup, { once: true });
  onStatus({
    state: 'requesting',
    message: 'Waiting for actual acceleration data…',
  });
}
