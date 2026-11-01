/** Minimal ZIP writer (stored, no compression): exports are JPEG/PNG, already compressed. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds a ZIP archive. No ZIP64: at most 65535 files and under 4 GiB in total. */
export function zip(entries: ZipEntry[], now = new Date()): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new RangeError('Trop de fichiers pour une archive ZIP');
  const enc = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const files = entries.map((e) => ({ name: enc.encode(e.name), data: e.data, crc: crc32(e.data) }));

  let size = 22;
  for (const f of files) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
  if (size > 0xffffffff) throw new RangeError('Archive ZIP trop volumineuse');

  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  const offsets: number[] = [];
  let p = 0;

  for (const f of files) {
    offsets.push(p);
    v.setUint32(p, 0x04034b50, true); // local file header
    v.setUint16(p + 4, 20, true); // version needed
    v.setUint16(p + 6, 0x0800, true); // UTF-8 names
    v.setUint16(p + 8, 0, true); // method: stored
    v.setUint16(p + 10, time, true);
    v.setUint16(p + 12, date, true);
    v.setUint32(p + 14, f.crc, true);
    v.setUint32(p + 18, f.data.length, true);
    v.setUint32(p + 22, f.data.length, true);
    v.setUint16(p + 26, f.name.length, true);
    v.setUint16(p + 28, 0, true); // extra length
    out.set(f.name, p + 30);
    out.set(f.data, p + 30 + f.name.length);
    p += 30 + f.name.length + f.data.length;
  }

  const centralStart = p;
  files.forEach((f, i) => {
    v.setUint32(p, 0x02014b50, true); // central directory header
    v.setUint16(p + 4, 20, true); // version made by
    v.setUint16(p + 6, 20, true); // version needed
    v.setUint16(p + 8, 0x0800, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, time, true);
    v.setUint16(p + 14, date, true);
    v.setUint32(p + 16, f.crc, true);
    v.setUint32(p + 20, f.data.length, true);
    v.setUint32(p + 24, f.data.length, true);
    v.setUint16(p + 28, f.name.length, true);
    // extra, comment, disk, internal and external attributes stay 0
    v.setUint32(p + 42, offsets[i], true);
    out.set(f.name, p + 46);
    p += 46 + f.name.length;
  });

  v.setUint32(p, 0x06054b50, true); // end of central directory
  v.setUint16(p + 8, files.length, true);
  v.setUint16(p + 10, files.length, true);
  v.setUint32(p + 12, p - centralStart, true);
  v.setUint32(p + 16, centralStart, true);
  return out;
}
