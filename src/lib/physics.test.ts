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
  it('keeps gentle repeated input within a small warp envelope', () => {
    const physics = new PosterPhysics(asset, { ...DEFAULT_SETTINGS });
    for (let i = 0; i < 50; i++) physics.shake(0.2);
    expect(physics.telemetry().elements[0].warp).toBeGreaterThan(0);
    expect(
      physics.telemetry().elements[0].warp / asset.elements[0].width,
    ).toBeLessThan(0.06);
    physics.dispose();
  });

  it('lets poster pieces cross the paper edge and collide with the expanded screen boundary', () => {
    const physics = new PosterPhysics(asset, { ...DEFAULT_SETTINGS });
    physics.setBounds({ x: -300, y: -100, width: 1000, height: 800 });
    physics.shake(0.4, { x: 1, y: 0 });
    const body = physics.entities[0].body;
    Matter.Body.setPosition(body, { x: 580, y: 300 });
    Matter.Body.setVelocity(body, { x: 12, y: 0 });
    for (let i = 0; i < 40; i++) physics.update(1000 / 60);
    expect(body.position.x).toBeGreaterThan(asset.width);
    expect(body.bounds.max.x).toBeLessThan(702);
    physics.dispose();
  });

  it('moves interface bodies with the same input without fracturing them', () => {
    const physics = new PosterPhysics(
      { ...asset, elements: [] },
      { ...DEFAULT_SETTINGS },
    );
    physics.setFixtures([
      { id: 'adjust-box', x: 200, y: 100, width: 90, height: 120 },
    ]);
    physics.shake(1, { x: 1, y: 1 });
    for (let i = 0; i < 150; i++) physics.update(1000 / 60);
    const fixture = physics.mapData().fixtures[0];
    expect(physics.fixtures).toHaveLength(1);
    expect(fixture.breakable).toBe(false);
    expect(fixture.y).toBeGreaterThan(100);
    expect(physics.fixtures[0].body.bounds.max.y).toBeLessThan(602);
    expect(physics.entities).toHaveLength(0);
    physics.dispose();
  });
  it('records cumulative center travel separately from net displacement', () => {
    const physics = new PosterPhysics(asset, { ...DEFAULT_SETTINGS });
    expect(physics.telemetry().elements[0].distance).toBe(0);
    physics.shake(0.2, { x: 0, y: 0 });
    const body = physics.entities[0].body;
    Matter.Body.setVelocity(body, { x: 10, y: 0 });
    for (let i = 0; i < 18; i++) physics.update(1000 / 60);
    const outward = physics.telemetry().elements[0];
    Matter.Body.setVelocity(body, { x: -10, y: 0 });
    for (let i = 0; i < 18; i++) physics.update(1000 / 60);
    const back = physics.telemetry().elements[0];
    expect(back.distance).toBeGreaterThan(outward.distance);
    expect(back.distance).toBeGreaterThan(Math.hypot(back.dx, back.dy) * 1.5);
    expect(physics.mapData().trackingUnits.rotation).toBe('degrees');
    physics.dispose();
  });

  it('retains the original start and recent route during long performances', () => {
    const physics = new PosterPhysics(asset, { ...DEFAULT_SETTINGS });
    physics.shake(0.1);
    physics.engine.gravity.scale = 0;
    const body = physics.entities[0].body;
    for (let i = 0; i < 2200; i++) {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Body.setPosition(body, {
        x: 200 + Math.cos(i * 0.04) * 80,
        y: 250 + Math.sin(i * 0.04) * 80,
      });
      physics.update(1000 / 60);
    }
    const data = physics.telemetry().elements[0];
    expect(data.path[0]).toEqual({ x: 200, y: 100 });
    expect(
      Math.hypot(data.path.at(-1)!.x - data.x, data.path.at(-1)!.y - data.y),
    ).toBeLessThan(15);
    expect(data.path.length).toBeLessThan(500);
    expect(data.distance).toBeGreaterThan(5000);
    expect(
      data.path.every(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
      ),
    ).toBe(true);
    physics.dispose();
  });
});
