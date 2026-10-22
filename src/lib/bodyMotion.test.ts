import { describe, expect, it } from 'vitest';
import { bodyMotion } from './bodyMotion';
import type { Joint } from './bodyMotion';
function person(): Joint[] {
  const points = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.2,
    visibility: 0,
  }));
  for (const [id, x, y] of [
    [11, 0.4, 0.3],
    [12, 0.6, 0.3],
    [13, 0.3, 0.4],
    [14, 0.7, 0.4],
    [15, 0.2, 0.5],
    [16, 0.8, 0.5],
    [23, 0.43, 0.55],
    [24, 0.57, 0.55],
    [25, 0.43, 0.72],
    [26, 0.57, 0.72],
    [27, 0.43, 0.9],
    [28, 0.57, 0.9],
  ])
    points[id] = { x, y, visibility: 0.95 };
  return points;
}
describe('person joint motion', () => {
  it('stays quiet without a person, on first detection, or while a pose is still', () => {
    const pose = person();
    expect(bodyMotion(null, [], 0.1).strength).toBe(0);
    expect(bodyMotion(null, pose, 0.1).strength).toBe(0);
    expect(bodyMotion(pose, pose, 0.1).strength).toBe(0);
    expect(bodyMotion(pose, [], 0.1).confidence).toBe(0);
  });
  it('maps vigorous limb movement to stronger performance than a gentle gesture', () => {
    const pose = person(),
      gentle = person(),
      dance = person();
    gentle[15].y -= 0.025;
    gentle[16].y += 0.025;
    dance[15].y -= 0.25;
    dance[16].y += 0.25;
    const soft = bodyMotion(pose, gentle, 0.1),
      hard = bodyMotion(pose, dance, 0.1);
    expect(soft.strength).toBeGreaterThan(0);
    expect(hard.strength).toBeGreaterThan(soft.strength * 3);
    expect(hard.tracking).toBe('body');
    expect(hard.confidence).toBeGreaterThan(0.8);
  });
  it('removes uniform panning and scale changes rather than treating them as dancing', () => {
    const pose = person();
    const pan = pose.map((p) => ({ ...p, x: p.x + 0.08, y: p.y - 0.03 }));
    const zoom = pose.map((p) => ({ ...p, x: p.x * 1.15, y: p.y * 1.15 }));
    expect(bodyMotion(pose, pan, 0.1).strength).toBe(0);
    expect(bodyMotion(pose, zoom, 0.1).strength).toBe(0);
  });
  it('rejects model jitter, obscured joints and tracking gaps', () => {
    const pose = person(),
      jitter = pose.map((p, i) => ({
        ...p,
        x: p.x + (i % 2 ? 0.0005 : -0.0005),
      }));
    expect(bodyMotion(pose, jitter, 0.1).strength).toBe(0);
    expect(
      bodyMotion(
        pose,
        pose.map((p) => ({ ...p, visibility: 0.2 })),
        0.1,
      ).confidence,
    ).toBe(0);
    const moved = person();
    moved[15].y -= 0.3;
    expect(bodyMotion(pose, moved, 1).strength).toBe(0);
  });
});
