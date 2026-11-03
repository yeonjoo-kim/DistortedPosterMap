import { describe, expect, it } from 'vitest';
import { randomTrailColor } from './trailColor';
describe('saturated RGB trails', () => {
  it('uses many distinct bright colors with a fully saturated channel range', () => {
    const values = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let calls = 0;
      const color = randomTrailColor(() => (calls++ % 2 === 0 ? i / 40 : 0.5));
      values.add(color);
      const rgb = color.match(/\d+/g)!.map(Number);
      expect(Math.max(...rgb)).toBeGreaterThanOrEqual(225);
      expect(Math.min(...rgb)).toBe(0);
    }
    expect(values.size).toBeGreaterThan(30);
  });
});
