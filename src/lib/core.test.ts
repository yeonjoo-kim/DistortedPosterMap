import { describe, expect, it } from 'vitest';
import { connectedRegions, dilate } from './segmentation';
import { shakeImpulse, zigzagOffset } from './math';

describe('foreground separation', () => {
  it('separates disconnected regions and preserves their pixel coordinates', () => {
    const { regions, labels } = connectedRegions(
      new Uint8Array([1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0]),
      5,
      3,
    );
    expect(regions).toEqual([
      { id: 1, x: 0, y: 0, width: 2, height: 2, count: 3 },
      { id: 2, x: 2, y: 1, width: 2, height: 2, count: 3 },
    ]);
    expect(labels[0]).toBe(1);
    expect(labels[8]).toBe(2);
    expect(labels[14]).toBe(0);
  });
  it('groups diagonal pixels without wrapping across row edges', () => {
    const { regions } = connectedRegions(
      new Uint8Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
      3,
      3,
    );
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.count)).toEqual([1, 2]);
  });
  it('merges nearby characters at coarser detail without changing other rows', () => {
    const mask = new Uint8Array([1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(connectedRegions(mask, 5, 2).regions).toHaveLength(2);
    const result = dilate(mask, 5, 2, 1);
    expect(connectedRegions(result, 5, 2).regions).toHaveLength(1);
    expect([...result.slice(5)]).toEqual([0, 0, 0, 0, 0]);
  });
  it('handles an empty poster without inventing objects', () => {
    expect(connectedRegions(new Uint8Array(100), 10, 10).regions).toHaveLength(
      0,
    );
  });
});

describe('proportional physical input', () => {
  it('scales force with both actual shaking amplitude and sensitivity', () => {
    expect(shakeImpulse(50, 0.4)).toBeCloseTo(0.2);
    expect(shakeImpulse(100, 0.4)).toBeCloseTo(0.4);
    expect(shakeImpulse(50, 0.8)).toBeCloseTo(0.4);
    expect(shakeImpulse(0, 1)).toBe(0);
  });
  it('clamps exceptional sensor values', () => {
    expect(shakeImpulse(200, 500)).toBe(1);
    expect(shakeImpulse(-20, 1)).toBe(0);
  });
  it('has continuous alternating zigzag coordinates proportional to amplitude', () => {
    expect([0, 25, 50, 75, 100].map((y) => zigzagOffset(y, 100, 10))).toEqual([
      10, -10, 10, -10, 10,
    ]);
    expect(zigzagOffset(12.5, 100, 10)).toBe(0);
    expect(zigzagOffset(25, 100, 20)).toBe(2 * zigzagOffset(25, 100, 10));
  });
});
