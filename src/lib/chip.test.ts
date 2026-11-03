import { describe, expect, it } from 'vitest';
import { clipPolygon, polygonCenter } from './math';
const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y;
}, 0)) / 2;
describe('edge chipping geometry', () => {
  it('cuts a small corner off a polygon while retaining the rest and conserving area', () => {
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const chip = clipPolygon(square, { x: 0.01, y: 0.01 }, 0.45);
    const core = clipPolygon(square, { x: 0.01, y: 0.01 }, 0.45, false);
    expect(chip).toHaveLength(3); expect(core).toHaveLength(5);
    expect(area(chip)).toBeLessThan(1200); expect(area(core)).toBeGreaterThan(8800);
    expect(area(chip) + area(core)).toBeCloseTo(10000);
    expect(polygonCenter(chip).x).toBeCloseTo(15); expect(polygonCenter(chip).y).toBeCloseTo(15);
    expect(Number.isFinite(polygonCenter(core).x)).toBe(true);
  });
});
