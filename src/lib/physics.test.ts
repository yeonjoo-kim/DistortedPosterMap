import { describe, expect, it } from 'vitest';
import { PosterPhysics } from './physics';
import { DEFAULT_SETTINGS } from './types';
import type { PosterAsset } from './types';

const asset: PosterAsset = {
  width: 400,
  height: 600,
  color: '#fff',
  method: 'test',
  pageCount: 1,
  source: {} as HTMLCanvasElement,
  background: {} as HTMLCanvasElement,
  elements: [
    {
      id: 'e1',
      label: 'poster text',
      kind: 'text',
      x: 200,
      y: 100,
      width: 80,
      height: 40,
      sprite: {} as HTMLCanvasElement,
    },
  ],
};

describe('physical workflow', () => {
  it('releases the original layout into finite movable bodies and records a real trajectory', () => {
    const physics = new PosterPhysics(asset, { ...DEFAULT_SETTINGS });
    expect(physics.entities[0].body.isStatic).toBe(true);
    physics.shake(1, { x: 1, y: -1 });
    expect(Number.isFinite(physics.entities[0].body.mass)).toBe(true);
    for (let i = 0; i < 25; i++) physics.update(1000 / 60);
    physics.shake(1, { x: -1, y: 1 });
    for (let i = 0; i < 25; i++) physics.update(1000 / 60);
    const element = physics.telemetry().elements[0];
    expect(Number.isFinite(element.x)).toBe(true);
    expect(Number.isFinite(element.y)).toBe(true);
    expect(Math.hypot(element.dx, element.dy)).toBeGreaterThan(10);
    expect(element.path.length).toBeGreaterThan(2);
    physics.dispose();
  });
  it('keeps zero-sensitivity input still and freezes a running simulation when paused', () => {
    const physics = new PosterPhysics(asset, {
      ...DEFAULT_SETTINGS,
      intensity: 0,
    });
    physics.shake();
    physics.update(1000 / 60);
    expect(physics.telemetry().elements[0].dy).toBe(0);
    physics.settings.intensity = 100;
    physics.shake();
    physics.update(1000 / 60);
    const before = physics.telemetry();
    physics.settings.paused = true;
    for (let i = 0; i < 10; i++) physics.update(1000 / 60);
    expect(physics.telemetry()).toEqual(before);
    physics.dispose();
  });
});
