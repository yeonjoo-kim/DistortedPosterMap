import { clamp } from './math';
import { FRACTURE_SPEED_THRESHOLD } from './motion';
import type { MotionSample } from './motion';
export interface Joint {
  x: number;
  y: number;
  visibility?: number;
}
export interface BodyFrame {
  pose: Joint[];
  face: Joint[];
  leftHand: Joint[];
  rightHand: Joint[];
}
export const PART_COLORS = {
  Head: '#ff25ce',
  Torso: '#00dc74',
  Arms: '#ff365f',
  Legs: '#00cfff',
  Hands: '#9747ff',
  Fingers: '#ff9600',
  Eyes: '#4366ff',
  Nose: '#ffc400',
  Mouth: '#ff5420',
} as const;
export type Part = keyof typeof PART_COLORS;
export interface BodyNode extends Joint {
  id: string;
  label: string;
  part: Part;
  strength: number;
}
export interface PartReading {
  part: Part;
  detected: boolean;
  strength: number;
  speed: number;
}
export interface BodyObservation {
  nodes: BodyNode[];
  parts: PartReading[];
  dominant: Part | null;
  effect: 'REST' | 'MOVE' | 'BEND' | 'BREAK';
}
const visible = (p?: Joint): p is Joint =>
  !!p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  (p.visibility ?? 1) >= 0.5;
const dist = (a: Joint, b: Joint) =>
  Math.hypot(((a.x - b.x) * 4) / 3, a.y - b.y);
const center = (points: Joint[]) => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});
const indexes = (p: Joint[], ids: number[]) =>
  ids.map((id) => p[id]).filter(visible);
const POSE: [Part, number[]][] = [
  ['Head', [0, 7, 8]],
  ['Torso', [11, 12, 23, 24]],
  ['Arms', [11, 12, 13, 14, 15, 16]],
  ['Legs', [23, 24, 25, 26, 27, 28]],
];
const FACE: [Part, number[]][] = [
  ['Head', [10, 152, 234, 454]],
  ['Eyes', [33, 133, 159, 145, 263, 362, 386, 374, 468, 473]],
  ['Nose', [1, 2, 4, 5, 98, 327]],
  ['Mouth', [13, 14, 61, 291, 78, 308]],
];
const POSE_NAMES: Record<number, string> = {
  0: 'Nose / head',
  7: 'Left ear',
  8: 'Right ear',
  11: 'Left shoulder',
  12: 'Right shoulder',
  13: 'Left elbow',
  14: 'Right elbow',
  15: 'Left wrist',
  16: 'Right wrist',
  23: 'Left hip',
  24: 'Right hip',
  25: 'Left knee',
  26: 'Right knee',
  27: 'Left ankle',
  28: 'Right ankle',
};
const HAND_NAMES = [
  'Wrist',
  'Thumb base',
  'Thumb joint',
  'Thumb joint',
  'Thumb tip',
  'Index base',
  'Index joint',
  'Index joint',
  'Index tip',
  'Middle base',
  'Middle joint',
  'Middle joint',
  'Middle tip',
  'Ring base',
  'Ring joint',
  'Ring joint',
  'Ring tip',
  'Little base',
  'Little joint',
  'Little joint',
  'Little tip',
];
export const BODY_LINKS: [string, string][] = [
  ...[
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
    [0, 7],
    [0, 8],
  ].map(([a, b]) => [`p${a}`, `p${b}`] as [string, string]),
  ...['l', 'r'].flatMap((side) =>
    [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [5, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [9, 13],
      [13, 14],
      [14, 15],
      [15, 16],
      [13, 17],
      [0, 17],
      [17, 18],
      [18, 19],
      [19, 20],
    ].map(([a, b]) => [`${side}${a}`, `${side}${b}`] as [string, string]),
  ),
  ...[
    [33, 159],
    [159, 133],
    [133, 145],
    [145, 33],
    [263, 386],
    [386, 362],
    [362, 374],
    [374, 263],
    [61, 13],
    [13, 291],
    [291, 14],
    [14, 61],
    [1, 2],
    [10, 234],
    [234, 152],
    [152, 454],
    [454, 10],
  ].map(([a, b]) => [`f${a}`, `f${b}`] as [string, string]),
];
function scaleOf(frame: BodyFrame) {
  const p = frame.pose;
  if (visible(p[11]) && visible(p[12]))
    return Math.max(
      0.12,
      dist(p[11], p[12]) * 2,
      visible(p[23]) ? dist(p[11], p[23]) * 2 : 0,
    );
  const face = indexes(frame.face, [10, 152, 234, 454]);
  return face.length === 4
    ? Math.max(0.15, dist(frame.face[234], frame.face[454]) * 3)
    : 0.4;
}
function local(points: Joint[], anchorIds: number[], ids: number[]) {
  const anchors = indexes(points, anchorIds);
  if (anchors.length < anchorIds.length) return ids.map(() => undefined);
  const c = center(anchors),
    size = Math.max(0.025, dist(anchors[0], anchors[1]));
  return ids.map((id) =>
    visible(points[id])
      ? { x: (points[id].x - c.x) / size, y: (points[id].y - c.y) / size }
      : undefined,
  );
}
function velocity(
  before: (Joint | undefined)[],
  after: (Joint | undefined)[],
  seconds: number,
  scale: number,
) {
  let sum = 0,
    n = 0,
    dx = 0,
    dy = 0,
    strongest = 0,
    best = { x: 0, y: 0 };
  for (let i = 0; i < after.length; i++)
    if (visible(after[i]) && visible(before[i])) {
      const x = ((after[i]!.x - before[i]!.x) * 4) / 3 / scale / seconds,
        y = (after[i]!.y - before[i]!.y) / scale / seconds,
        v = x * x + y * y;
      sum += v;
      n++;
      dx += x;
      dy += y;
      if (v > strongest) {
        strongest = v;
        best = { x, y };
      }
    }
  return {
    speed: n >= 2 ? Math.sqrt(sum / n) : 0,
    direction: Math.hypot(dx, dy) > 0.08 ? { x: dx, y: dy } : best,
  };
}
export function motionEffect(strength: number): BodyObservation['effect'] {
  return strength < 0.08
    ? 'REST'
    : strength < 0.35
      ? 'MOVE'
      : strength <= FRACTURE_SPEED_THRESHOLD
        ? 'BEND'
        : 'BREAK';
}
/** Normalized landmark velocity. No motion is inferred without detected nodes. */
export function bodyMotion(
  previous: BodyFrame | null,
  frame: BodyFrame,
  seconds: number,
): MotionSample {
  const readings: PartReading[] = Object.keys(PART_COLORS).map((part) => ({
    part: part as Part,
    detected: false,
    strength: 0,
    speed: 0,
  }));
  const nodes = new Map<string, BodyNode>();
  const validTime = !!previous && seconds > 0 && seconds < 1;
  let bestStrength = 0,
    dominant: Part | null = null,
    direction = { x: 0, y: 0 };
  const record = (
    part: Part,
    points: (Joint | undefined)[],
    prior: (Joint | undefined)[],
    scale: number,
    noise = 0.1,
    range = 2.2,
  ) => {
    const found = points.filter(visible).length >= 2;
    const v =
      found && validTime
        ? velocity(prior, points, seconds, scale)
        : { speed: 0, direction: { x: 0, y: 0 } };
    const strength = clamp((v.speed - noise) / range, 0, 1) ** 0.8;
    const reading = readings.find((r) => r.part === part)!;
    reading.detected ||= found;
    if (strength >= reading.strength) {
      reading.strength = strength;
      reading.speed = v.speed;
    }
    if (strength > bestStrength) {
      bestStrength = strength;
      dominant = part;
      direction = v.direction;
    }
  };
  const size = previous
    ? (scaleOf(frame) + scaleOf(previous)) / 2
    : scaleOf(frame);
  for (const [part, ids] of POSE) {
    record(
      part,
      ids.map((i) => frame.pose[i]),
      ids.map((i) => previous?.pose[i]),
      size,
    );
    for (const i of ids)
      if (visible(frame.pose[i]))
        nodes.set(`p${i}`, {
          ...frame.pose[i],
          id: `p${i}`,
          label: POSE_NAMES[i],
          part,
          strength: 0,
        });
  }
  for (const [side, key] of [
    ['l', 'leftHand'],
    ['r', 'rightHand'],
  ] as const) {
    const hand = frame[key],
      old = previous?.[key] ?? [];
    record(
      'Hands',
      [0, 5, 9, 13, 17].map((i) => hand[i]),
      [0, 5, 9, 13, 17].map((i) => old[i]),
      size,
    );
    record(
      'Fingers',
      local(hand, [0, 9], [4, 8, 12, 16, 20]),
      local(old, [0, 9], [4, 8, 12, 16, 20]),
      1,
      0.2,
      4,
    );
    hand.forEach((point, i) => {
      if (visible(point))
        nodes.set(`${side}${i}`, {
          ...point,
          id: `${side}${i}`,
          label: `${side === 'l' ? 'Left' : 'Right'} ${HAND_NAMES[i]}`,
          part: i === 0 ? 'Hands' : 'Fingers',
          strength: 0,
        });
    });
  }
  for (const [part, ids] of FACE) {
    if (part === 'Head')
      record(
        part,
        ids.map((i) => frame.face[i]),
        ids.map((i) => previous?.face[i]),
        size,
      );
    else
      record(
        part,
        local(frame.face, [234, 454], ids),
        local(previous?.face ?? [], [234, 454], ids),
        1,
        part === 'Mouth' ? 0.15 : part === 'Eyes' ? 0.08 : 0.2,
        part === 'Mouth' ? 2 : part === 'Eyes' ? 2.5 : 3.5,
      );
    for (const i of ids)
      if (visible(frame.face[i]))
        nodes.set(`f${i}`, {
          ...frame.face[i],
          id: `f${i}`,
          label: `${part} ${i}`,
          part,
          strength: 0,
        });
  }
  const detected = readings.filter((r) => r.detected).length;
  const strength = bestStrength < 0.08 ? 0 : bestStrength;
  const fractureStrength = Math.max(0, ...readings.filter((r) =>
    ['Head', 'Torso', 'Arms', 'Legs', 'Hands'].includes(r.part)).map((r) => r.strength));
  const length = Math.hypot(direction.x, direction.y);
  return {
    source: 'body',
    strength,
    fractureStrength,
    magnitude: Math.max(0, ...readings.map((r) => r.speed)),
    confidence: detected ? 1 : 0,
    direction:
      length > 0.01
        ? { x: -direction.x / length, y: direction.y / length }
        : { x: 0, y: 0 },
    body: {
      parts: readings,
      dominant: strength ? dominant : null,
      effect: fractureStrength > FRACTURE_SPEED_THRESHOLD ? 'BREAK' : motionEffect(Math.min(strength, FRACTURE_SPEED_THRESHOLD)),
      nodes: [...nodes.values()].map((node) => ({
        ...node,
        strength: readings.find((r) => r.part === node.part)!.strength,
      })),
    },
  };
}
