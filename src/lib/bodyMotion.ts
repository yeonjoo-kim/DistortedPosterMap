import { clamp } from './math';
import type { MotionSample } from './motion';

export interface Joint {
  x: number;
  y: number;
  visibility?: number;
}
export const BODY_CONNECTIONS = [
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
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const valid = (p?: Joint): p is Joint =>
  !!p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  (p.visibility ?? 1) >= 0.55;
function bodyFrame(points: Joint[]) {
  if (!valid(points[11]) || !valid(points[12])) return null;
  const visible = JOINTS.filter((id) => valid(points[id]));
  if (visible.length < 6) return null;
  const shoulders = {
    x: (points[11].x + points[12].x) / 2,
    y: (points[11].y + points[12].y) / 2,
  };
  const hips =
    valid(points[23]) && valid(points[24])
      ? {
          x: (points[23].x + points[24].x) / 2,
          y: (points[23].y + points[24].y) / 2,
        }
      : shoulders;
  const width = Math.hypot(
    points[11].x - points[12].x,
    points[11].y - points[12].y,
  );
  const scale = Math.max(
    0.1,
    width * 1.8,
    Math.hypot(hips.x - shoulders.x, hips.y - shoulders.y) * 2.2,
  );
  return {
    center: { x: (hips.x + shoulders.x) / 2, y: (hips.y + shoulders.y) / 2 },
    scale,
    visible,
  };
}

/** Body-relative joint speed, independent of background motion and camera panning. */
export function bodyMotion(
  previous: Joint[] | null,
  current: Joint[],
  seconds: number,
): MotionSample {
  const now = bodyFrame(current),
    before = previous && bodyFrame(previous);
  const idle: MotionSample = {
    source: 'camera',
    tracking: 'body',
    strength: 0,
    magnitude: 0,
    direction: { x: 0, y: 0 },
    confidence: now ? now.visible.length / JOINTS.length : 0,
    landmarks: now ? current : [],
  };
  if (!now || !before || seconds <= 0 || seconds > 0.5) return idle;
  const shared = now.visible.filter((id) => valid(previous![id]));
  if (shared.length < 6) return idle;
  let speed2 = 0,
    dx = 0,
    dy = 0,
    total = 0;
  for (const id of shared) {
    const old = previous![id],
      next = current[id];
    const vx =
      ((next.x - now.center.x) / now.scale -
        (old.x - before.center.x) / before.scale) /
      seconds;
    const vy =
      ((next.y - now.center.y) / now.scale -
        (old.y - before.center.y) / before.scale) /
      seconds;
    const weight = [15, 16, 27, 28].includes(id) ? 2 : 1;
    speed2 += (vx * vx + vy * vy) * weight;
    dx += vx * weight;
    dy += vy * weight;
    total += weight;
  }
  const magnitude = Math.sqrt(speed2 / total);
  // Subtract model jitter before expanding the useful performance range.
  const strength = clamp((magnitude - 0.12) / 2.5, 0, 1) ** 0.75;
  const length = Math.hypot(dx, dy);
  const direction =
    length > 0.08
      ? { x: -dx / length, y: dy / length }
      : { x: Math.sin(current[15]?.y * 12 || 0) * 0.8, y: -0.8 };
  return {
    ...idle,
    magnitude,
    strength,
    direction: strength > 0 ? direction : idle.direction,
  };
}
