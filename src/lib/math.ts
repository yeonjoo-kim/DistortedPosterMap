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

export function materialResponse(amplitude: number) {
  const strength = shakeImpulse(amplitude);
  return {
    strength,
    gravity: 0.24 + strength * 0.82,
    restitution: 0.035 + strength * 0.24,
    sharpness: strength,
    canFracture: strength >= 0.65,
  };
}
export function zigzagOffset(y: number, height: number, amplitude: number) {
  const t = (y / Math.max(1, height)) * 4;
  return (Math.abs((((t % 2) + 2) % 2) - 1) * 2 - 1) * amplitude;
}
