import { describe, expect, it } from 'vitest';
import Matter from 'matter-js';
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
    physics.shake(0.45, { x: 1, y: -1 });
    expect(Number.isFinite(physics.entities[0].body.mass)).toBe(true);
    for (let i = 0; i < 25; i++) physics.update(1000 / 60);
    physics.shake(0.45, { x: -1, y: 1 });
    for (let i = 0; i < 25; i++) physics.update(1000 / 60);
    const element = physics.telemetry().elements[0];
    expect(Number.isFinite(element.x)).toBe(true);
    expect(Number.isFinite(element.y)).toBe(true);
    expect(Math.hypot(element.dx, element.dy)).toBeGreaterThan(10);
    expect(element.path.length).toBeGreaterThan(2);
    physics.dispose();
  });
  it('keeps zero-amplitude input still and freezes a running simulation when paused', () => {
    const physics = new PosterPhysics(asset, {
      ...DEFAULT_SETTINGS,
    });
    physics.shake(0);
    physics.update(1000 / 60);
    expect(physics.telemetry().elements[0].dy).toBe(0);
    physics.shake(0.4);
    physics.update(1000 / 60);
    const before = physics.telemetry();
    physics.settings.paused = true;
    for (let i = 0; i < 10; i++) physics.update(1000 / 60);
    expect(physics.telemetry()).toEqual(before);
    physics.dispose();
  });
  it('combines gravity, warping and recoverable collision compression without selecting a mode', () => {
    const physics = new PosterPhysics(asset, { ...DEFAULT_SETTINGS });
    physics.shake(0.4, { x: 0.2, y: 1 });
    const body = physics.entities[0].body;
    Matter.Body.setPosition(body, { x: 200, y: 582 });
    Matter.Body.setVelocity(body, { x: 0, y: 12 });
    physics.update(1000 / 60);
    const hit = physics.telemetry().elements[0];
    expect(hit.warp).toBeGreaterThan(0);
    expect(hit.compression).toBeGreaterThan(0.05);
    expect(hit.scaleY).toBeLessThan(1);
    expect(physics.engine.gravity.y).toBeGreaterThan(0);
    expect(physics.entities).toHaveLength(1);
    for (let i = 0; i < 40; i++) physics.update(1000 / 60);
    expect(physics.telemetry().elements[0].compression).toBeLessThan(
      hit.compression,
    );
    expect(
      physics
        .mapData()
        .elements[0].deformationVertices.every(
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
        ),
    ).toBe(true);
    physics.dispose();
  });
});
