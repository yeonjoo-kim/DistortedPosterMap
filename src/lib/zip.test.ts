import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from './zip';

describe('individual PNG archive', () => {
  it('uses the standard CRC32 checksum and preserves entries with UTF-8 names', async () => {
    const bytes = new TextEncoder().encode('123456789');
    expect(crc32(bytes)).toBe(0xcbf43926);
    const result = new Uint8Array(await zipFiles([{ name: '조각.png', data: bytes }]).arrayBuffer());
    const view = new DataView(result.buffer), nameLength = view.getUint16(26, true);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x800);
    expect(new TextDecoder().decode(result.subarray(30, 30 + nameLength))).toBe('조각.png');
    expect(result.subarray(30 + nameLength, 30 + nameLength + bytes.length)).toEqual(bytes);
    expect(view.getUint32(result.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(result.length - 12, true)).toBe(1);
    expect(view.getUint32(view.getUint32(result.length - 6, true), true)).toBe(0x02014b50);
  });
});
