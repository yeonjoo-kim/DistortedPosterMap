export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function shakeImpulse(amplitude: number) {
  return Number.isFinite(amplitude) ? clamp(amplitude, 0, 1) : 0;
}

export function clayOffset(
  y: number,
  height: number,
  amplitude: number,
  sharpness: number,
) {
  const smooth = Math.cos((y / Math.max(1, height)) * Math.PI * 4) * amplitude;
  const blend = clamp((sharpness - 0.25) / 0.65, 0, 1);
  return smooth * (1 - blend) + zigzagOffset(y, height, amplitude) * blend;
}

export const MATERIAL_MIX = { zigzag: 0.2, fracture: 0.8 } as const;

export function materialResponse(amplitude: number) {
  const strength = shakeImpulse(amplitude);
  return {
    strength,
    gravity: 0,
    restitution: 0.65 + strength * 0.2,
    sharpness: strength,
    canFracture: strength >= 0.9 - MATERIAL_MIX.fracture * 0.5,
  };
}
export function zigzagOffset(y: number, height: number, amplitude: number) {
  const t = (y / Math.max(1, height)) * 4;
  return (Math.abs((((t % 2) + 2) % 2) - 1) * 2 - 1) * amplitude;
}

/** Clip a convex polygon on either side of a line; shared edges stay identical. */
export function clipPolygon(points: { x: number; y: number }[], normal: { x: number; y: number }, offset: number, keepLess = true) {
  const output: { x: number; y: number }[] = [];
  const signed = (p: { x: number; y: number }) => (p.x * normal.x + p.y * normal.y - offset) * (keepLess ? 1 : -1);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], da = signed(a), db = signed(b);
    if (da <= 0) output.push({ ...a });
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return output;
}
export function polygonCenter(points: { x: number; y: number }[]) {
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], cross = a.x * b.y - b.x * a.y;
    area += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}
