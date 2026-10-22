export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function shakeImpulse(intensity: number, amplitude: number) {
  return clamp(intensity / 100, 0, 1) * clamp(amplitude, 0, 1);
}
export function zigzagOffset(y: number, height: number, amplitude: number) {
  const t = (y / Math.max(1, height)) * 4;
  return (Math.abs((((t % 2) + 2) % 2) - 1) * 2 - 1) * amplitude;
}
