import { crc32, deflateRawSync } from 'node:zlib';

/** Small generated ZIPs for adversarial tests; no third-party Mod or fixture is copied. */
export function modZip(entries: Array<[string, string | Buffer]>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [filename, content] of entries) {
    const name = Buffer.from(filename); const raw = Buffer.from(content); const body = deflateRawSync(raw); const crc = crc32(raw);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26);
    local.push(head, name, body);
    const item = Buffer.alloc(46); item.writeUInt32LE(0x02014b50); item.writeUInt16LE(20, 4); item.writeUInt16LE(20, 6);
    item.writeUInt16LE(0x800, 8); item.writeUInt16LE(8, 10); item.writeUInt32LE(crc, 16);
    item.writeUInt32LE(body.length, 20); item.writeUInt32LE(raw.length, 24); item.writeUInt16LE(name.length, 28); item.writeUInt32LE(offset, 42);
    central.push(item, name); offset += 30 + name.length + body.length;
  }
  const center = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, center, end]);
}
