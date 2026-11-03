import { describe, expect, it } from 'vitest';
import { connectedRegions, dilate, colorRegions } from './segmentation';
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
  it('uses only measured amplitude, without a sensitivity multiplier', () => {
    expect(shakeImpulse(0.2)).toBeCloseTo(0.2);
    expect(shakeImpulse(0.4)).toBeCloseTo(0.4);
    expect(shakeImpulse(0)).toBe(0);
  });
  it('rejects nonfinite inputs and clamps exceptional sensor values', () => {
    expect(shakeImpulse(500)).toBe(1);
    expect(shakeImpulse(-20)).toBe(0);
    expect(shakeImpulse(NaN)).toBe(0);
    expect(shakeImpulse(Infinity)).toBe(0);
  });
  it('has continuous alternating zigzag coordinates proportional to amplitude', () => {
    expect([0, 25, 50, 75, 100].map((y) => zigzagOffset(y, 100, 10))).toEqual([
      10, -10, 10, -10, 10,
    ]);
    expect(zigzagOffset(12.5, 100, 10)).toBe(0);
    expect(zigzagOffset(25, 100, 20)).toBe(2 * zigzagOffset(25, 100, 10));
  });
});


describe('color and boundary separation', () => {
  it('separates touching colors, individual glyphs and the background with exact pixel coverage', () => {
    const w = 40, h = 30, pixels = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = y > 5 && y < 20 && (x > 5 && x < 10 || x > 15 && x < 20);
      pixels.set(ink ? [0, 0, 0, 255] : x > 25 ? [255, 0, 0, 255] : [255, 255, 255, 255], i);
    }
    const { regions, labels } = colorRegions(pixels, w, h, 12);
    expect(labels[10 * w + 7]).not.toBe(labels[10 * w + 17]);
    expect(labels[10 * w + 24]).not.toBe(labels[10 * w + 26]);
    expect(regions.reduce((n, r) => n + r.count, 0)).toBe(w * h);
    expect([...labels].every((id) => id > 0)).toBe(true);
    expect(regions.length).toBeGreaterThan(4);
  });
  it('leaves transparent pixels transparent and preserves isolated opaque islands', () => {
    const pixels = new Uint8ClampedArray(100 * 4);
    pixels.set([10, 20, 30, 255], 0);
    pixels.set([250, 200, 150, 255], 99 * 4);
    const result = colorRegions(pixels, 10, 10);
    expect(result.labels[0]).not.toBe(result.labels[99]);
    expect(result.labels[1]).toBe(0);
    expect(result.regions.reduce((n, r) => n + r.count, 0)).toBe(2);
  });
});
