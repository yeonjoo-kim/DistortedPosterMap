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
