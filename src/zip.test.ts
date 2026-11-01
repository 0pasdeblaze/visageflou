import { describe, expect, it } from 'vitest';
import { crc32, zip } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(bytes('hello'))).toBe(0x3610a686);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('writes a readable central directory with UTF-8 names', () => {
    const out = zip([
      { name: 'a-flou.jpg', data: bytes('première') },
      { name: 'été.png', data: bytes('x') },
    ]);
    const v = new DataView(out.buffer);
    const eocd = out.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);

    const start = v.getUint32(eocd + 16, true);
    expect(v.getUint32(start, true)).toBe(0x02014b50);
    const nameLen = v.getUint16(start + 28, true);
    expect(new TextDecoder().decode(out.subarray(start + 46, start + 46 + nameLen))).toBe('a-flou.jpg');
    // local header offset of the first entry is 0 and its data follows the name
    expect(v.getUint32(start + 42, true)).toBe(0);
    expect(new TextDecoder().decode(out.subarray(30 + nameLen, 30 + nameLen + v.getUint32(18, true)))).toBe('première');
  });

  it('handles an empty archive', () => {
    const out = zip([]);
    expect(out.length).toBe(22);
  });
});
