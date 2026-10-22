import { cameraStrength, estimateCameraMotion } from './vision';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accelerationSample, startDeviceMotion } from './motion';
import type { InputStatus, MotionSample } from './motion';
import { distortionCurve, soundProfile } from './instrument';
import { materialResponse } from './math';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('actual acceleration input', () => {
  it('ignores sensor noise and scales only with measured movement', () => {
    expect(accelerationSample({ x: 0, y: 0.1, z: 0 }).strength).toBe(0);
    const soft = accelerationSample({ x: 2, y: 0, z: 0 });
    const hard = accelerationSample({ x: 15, y: 0, z: 0 });
    expect(hard.strength).toBeGreaterThan(soft.strength * 4);
    expect(soft.source).toBe('sensor');
    expect(accelerationSample({ x: NaN, y: 0, z: 0 }).strength).toBe(0);
  });
  it('does not claim a sensor is connected when the API exists but no real data arrives', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'performance'],
    });
    const target = new EventTarget();
    Object.assign(target, {
      DeviceMotionEvent: class {},
      isSecureContext: true,
      setInterval,
      clearInterval,
    });
    vi.stubGlobal('window', target);
    const statuses: InputStatus[] = [],
      samples: MotionSample[] = [];
    const control = new AbortController();
    await startDeviceMotion(
      (s) => samples.push(s),
      (s) => statuses.push(s),
      control.signal,
    );
    const empty = new Event('devicemotion');
    Object.assign(empty, {
      acceleration: { x: null, y: null, z: null },
      accelerationIncludingGravity: null,
    });
    target.dispatchEvent(empty);
    vi.advanceTimersByTime(5000);
    expect(statuses.at(-1)?.state).toBe('unavailable');
    expect(statuses.some((s) => s.state === 'connected')).toBe(false);
    expect(samples).toHaveLength(0);
    control.abort();
  });
  it('requires two measured samples and removes the event listener on disconnect', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'performance'],
    });
    const target = new EventTarget();
    Object.assign(target, {
      DeviceMotionEvent: class {},
      isSecureContext: true,
      setInterval,
      clearInterval,
    });
    vi.stubGlobal('window', target);
    const statuses: InputStatus[] = [],
      samples: MotionSample[] = [];
    const control = new AbortController();
    await startDeviceMotion(
      (s) => samples.push(s),
      (s) => statuses.push(s),
      control.signal,
    );
    const emit = () => {
      const e = new Event('devicemotion');
      Object.assign(e, {
        acceleration: { x: 4, y: 0, z: 0 },
        accelerationIncludingGravity: null,
      });
      target.dispatchEvent(e);
    };
    emit();
    expect(statuses.at(-1)?.state).toBe('requesting');
    vi.advanceTimersByTime(40);
    emit();
    expect(statuses.at(-1)?.state).toBe('connected');
    expect(samples[0].strength).toBeGreaterThan(0);
    control.abort();
    const count = samples.length;
    vi.advanceTimersByTime(50);
    emit();
    expect(samples).toHaveLength(count);
  });
});

function texture(width: number, height: number) {
  let seed = 9137;
  return Uint8Array.from({ length: width * height }, () => {
    seed = (seed * 16807) % 2147483647;
    return (seed % 220) + 15;
  });
}
function shifted(
  source: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
) {
  const output = new Uint8Array(source.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = x - dx,
        sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < width && sy < height)
        output[y * width + x] = source[sy * width + sx];
    }
  return output;
}
describe('camera relative-motion estimation', () => {
  it('amplifies small tracked movement while keeping still and unreliable scenes quiet', () => {
    expect(cameraStrength(0, 1)).toBe(0);
    expect(cameraStrength(12, 1)).toBeGreaterThan(0.25);
    expect(cameraStrength(40, 1)).toBeGreaterThan(cameraStrength(12, 1));
    expect(cameraStrength(100, 0.3)).toBe(0);
    expect(cameraStrength(NaN, 1)).toBe(0);
  });
  it('recovers a global scene shift across the frame', () => {
    const a = texture(128, 96),
      b = shifted(a, 128, 96, 3, -2);
    const flow = estimateCameraMotion(a, b, 128, 96);
    expect(flow.dx).toBeCloseTo(3, 0);
    expect(flow.dy).toBeCloseTo(-2, 0);
    expect(flow.confidence).toBeGreaterThan(0.75);
  });
  it('keeps a still scene quiet and rejects an untextured background', () => {
    const a = texture(128, 96);
    expect(estimateCameraMotion(a, a, 128, 96).magnitude).toBe(0);
    expect(
      estimateCameraMotion(
        new Uint8Array(128 * 96).fill(120),
        new Uint8Array(128 * 96).fill(150),
        128,
        96,
      ).confidence,
    ).toBe(0);
  });
  it('does not treat a small moving foreground patch as global laptop motion', () => {
    const a = texture(128, 96),
      b = new Uint8Array(a),
      moved = shifted(a, 128, 96, 4, 1);
    for (let y = 35; y < 60; y++)
      for (let x = 48; x < 78; x++) b[y * 128 + x] = moved[y * 128 + x];
    expect(estimateCameraMotion(a, b, 128, 96).magnitude).toBeLessThan(0.5);
  });
});

describe('continuous material and instrument response', () => {
  it('makes a stronger measured input both more deformable and capable of fracturing', () => {
    const soft = materialResponse(0.15),
      hard = materialResponse(0.85);
    expect(hard.gravity).toBeGreaterThan(soft.gravity);
    expect(hard.restitution).toBeGreaterThan(soft.restitution);
    expect(soft.canFracture).toBe(false);
    expect(hard.canFracture).toBe(true);
  });
  it('plays heavier, faster power chords for stronger motion and stays silent at rest', () => {
    const soft = soundProfile(0.1),
      hard = soundProfile(0.9);
    expect(hard.cutoff).toBeGreaterThan(soft.cutoff * 10);
    expect(hard.drive).toBeGreaterThan(soft.drive * 2);
    expect(hard.pickInterval).toBeLessThan(soft.pickInterval / 2);
    expect(hard.midi).toBeGreaterThan(soft.midi);
    expect(hard.sustain).toBeGreaterThan(soft.sustain);
    expect(soundProfile(0).gain).toBe(0);
    expect(soundProfile(NaN).gain).toBe(0);
    const curve = distortionCurve(10);
    expect(Math.max(...curve)).toBeLessThanOrEqual(1);
    expect(curve[1500]).toBeGreaterThan(0.99);
    expect(curve[547]).toBeCloseTo(-curve[1500], 4);
  });
});
