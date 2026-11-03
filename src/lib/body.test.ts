import { describe, expect, it } from 'vitest';
import { bodyMotion, motionEffect } from './body';
import type { BodyFrame, Joint } from './body';
function person(): BodyFrame {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.3,
    visibility: 0,
  }));
  for (const [id, x, y] of [
    [0, 0.5, 0.2],
    [7, 0.46, 0.22],
    [8, 0.54, 0.22],
    [11, 0.4, 0.35],
    [12, 0.6, 0.35],
    [13, 0.3, 0.45],
    [14, 0.7, 0.45],
    [15, 0.2, 0.55],
    [16, 0.8, 0.55],
    [23, 0.44, 0.6],
    [24, 0.56, 0.6],
    [25, 0.44, 0.75],
    [26, 0.56, 0.75],
    [27, 0.44, 0.93],
    [28, 0.56, 0.93],
  ])
    pose[id] = { x, y, visibility: 0.95 };
  const face = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.23,
    visibility: 0,
  }));
  for (const [id, x, y] of [
    [10, 0.5, 0.17],
    [152, 0.5, 0.3],
    [234, 0.45, 0.23],
    [454, 0.55, 0.23],
    [33, 0.46, 0.21],
    [133, 0.49, 0.21],
    [159, 0.475, 0.205],
    [145, 0.475, 0.215],
    [263, 0.54, 0.21],
    [362, 0.51, 0.21],
    [386, 0.525, 0.205],
    [374, 0.525, 0.215],
    [468, 0.475, 0.21],
    [473, 0.525, 0.21],
    [1, 0.5, 0.23],
    [2, 0.5, 0.24],
    [4, 0.5, 0.232],
    [5, 0.5, 0.225],
    [98, 0.49, 0.24],
    [327, 0.51, 0.24],
    [13, 0.5, 0.26],
    [14, 0.5, 0.27],
    [61, 0.48, 0.265],
    [291, 0.52, 0.265],
    [78, 0.485, 0.265],
    [308, 0.515, 0.265],
  ])
    face[id] = { x, y, visibility: 0.95 };
  const hand = (base: number): Joint[] =>
    Array.from({ length: 21 }, (_, i) => ({
      x: base + (i % 4) * 0.008,
      y: 0.55 - Math.floor(i / 4) * 0.012,
      visibility: 0.95,
    }));
  const leftHand = hand(0.2),
    rightHand = hand(0.76);
  leftHand[9] = { x: 0.2, y: 0.49 };
  rightHand[9] = { x: 0.76, y: 0.49 };
  return { pose, face, leftHand, rightHand };
}
describe('body, face and hand node measurements', () => {
  it('reports every requested region without inventing movement in a still pose', () => {
    const frame = person(),
      sample = bodyMotion(frame, frame, 0.1);
    expect(sample.body?.parts.filter((part) => part.detected)).toHaveLength(9);
    expect(
      sample.body?.nodes.some((node) => node.label === 'Left Index tip'),
    ).toBe(true);
    expect(sample.strength).toBe(0);
    expect(sample.body?.effect).toBe('REST');
    expect(bodyMotion(null, frame, 0.1).strength).toBe(0);
    expect(
      bodyMotion(
        frame,
        { pose: [], face: [], leftHand: [], rightHand: [] },
        0.1,
      ).confidence,
    ).toBe(0);
  });
  it('turns larger arm gestures into a larger signal and a clearly named effect', () => {
    const frame = person(),
      soft = person(),
      hard = person();
    soft.pose[15].y -= 0.025;
    soft.pose[16].y += 0.025;
    hard.pose[15].y -= 0.3;
    hard.pose[16].y += 0.3;
    const gentle = bodyMotion(frame, soft, 0.1),
      strong = bodyMotion(frame, hard, 0.1);
    expect(gentle.strength).toBeGreaterThan(0);
    expect(strong.strength).toBeGreaterThan(gentle.strength * 2);
    expect(strong.body?.dominant).toBe('Arms');
    expect(strong.body?.effect).toBe('BREAK');
  });
  it('separates palm translation from finger articulation and local face expression', () => {
    const frame = person(),
      wave = person(),
      fingers = person(),
      mouth = person(),
      eyes = person(),
      nose = person();
    wave.leftHand = wave.leftHand.map((p) => ({ ...p, x: p.x + 0.08 }));
    for (const i of [4, 8, 12, 16, 20]) fingers.leftHand[i].y -= 0.07;
    mouth.face[13].y -= 0.04;
    mouth.face[14].y += 0.04;
    eyes.face[159].y += 0.008;
    eyes.face[386].y += 0.008;
    nose.face[1].x += 0.015;
    nose.face[2].x += 0.015;
    expect(bodyMotion(frame, wave, 0.1).body?.dominant).toBe('Hands');
    expect(bodyMotion(frame, fingers, 0.1).body?.dominant).toBe('Fingers');
    expect(bodyMotion(frame, mouth, 0.1).body?.dominant).toBe('Mouth');
    expect(bodyMotion(frame, eyes, 0.1).body?.dominant).toBe('Eyes');
    expect(bodyMotion(frame, nose, 0.1).body?.dominant).toBe('Nose');
  });
  it('ignores a tracking gap and exposes exact reaction boundaries', () => {
    const frame = person(),
      next = person();
    next.pose[15].x += 0.4;
    expect(bodyMotion(frame, next, 2).strength).toBe(0);
    expect([0.07, 0.08, 0.34, 0.35, 0.75, 0.76].map(motionEffect)).toEqual([
      'REST',
      'MOVE',
      'MOVE',
      'BEND',
      'BEND',
      'BREAK',
    ]);
  });
});
