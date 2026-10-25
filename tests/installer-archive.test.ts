import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractSelectedArchive } from '../src/services/install/native-archive.js';
import { INSTALLER_ENTRIES, parseInstallerArchiveReply, parseInstallerArchiveRequest } from '../src/services/workers/installer-archive-protocol.js';

function zip(entries: Array<{ name: string; body: Buffer }>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const body = deflateRawSync(entry.body); const crc = crc32(entry.body);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(entry.body.length, 22); head.writeUInt16LE(name.length, 26);
    local.push(head, name, body);
    const item = Buffer.alloc(46); item.writeUInt32LE(0x02014b50); item.writeUInt16LE(20, 4); item.writeUInt16LE(20, 6); item.writeUInt16LE(0x800, 8); item.writeUInt16LE(8, 10);
    item.writeUInt32LE(crc, 16); item.writeUInt32LE(body.length, 20); item.writeUInt32LE(entry.body.length, 24); item.writeUInt16LE(name.length, 28); item.writeUInt32LE(offset, 42);
    central.push(item, name); offset += head.length + name.length + body.length;
  }
  const center = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...local, center, end]);
}

async function fixture(work: (root: string, file: string, input: { file: string; sha256: string; size: number }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-installer-archive-')); const file = path.join(root, 'installer.jar');
  const bytes = zip(INSTALLER_ENTRIES.map((name, index) => ({ name, body: Buffer.from(index === 2 ? 'patch' : '{}') })));
  await writeFile(file, bytes); const input = { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await work(root, file, input);
}

test('verified installer extraction writes only the fixed selected entries', async () => fixture(async (root, _file, input) => {
  const destination = path.join(root, 'out'); await mkdir(destination);
  assert.deepEqual(await extractSelectedArchive(destination, input, INSTALLER_ENTRIES), { files: 3, bytes: 9 });
  assert.equal((await readFile(path.join(destination, 'install_profile.json'), 'utf8')), '{}');
  assert.equal((await readFile(path.join(destination, 'version.json'), 'utf8')), '{}');
  assert.equal((await readFile(path.join(destination, 'data/client.lzma'), 'utf8')), 'patch');
}));

test('installer extraction refuses wrong hashes, missing entries and nonempty destinations', async () => fixture(async (root, _file, input) => {
  const wrong = path.join(root, 'wrong'); await mkdir(wrong);
  await assert.rejects(extractSelectedArchive(wrong, { ...input, sha256: '0'.repeat(64) }, INSTALLER_ENTRIES), { code: 'HASH_MISMATCH' });
  const missing = path.join(root, 'missing'); await mkdir(missing);
  await assert.rejects(extractSelectedArchive(missing, input, [...INSTALLER_ENTRIES, 'absent']), { code: 'INVALID_ARCHIVE' });
  const occupied = path.join(root, 'occupied'); await mkdir(occupied); await writeFile(path.join(occupied, 'keep'), 'user');
  await assert.rejects(extractSelectedArchive(occupied, input, INSTALLER_ENTRIES), { code: 'UNSAFE_ARCHIVE' });
}));

test('installer worker protocol accepts no arbitrary entries, commands or reply shapes', () => {
  const request = { version: 1, kind: 'loader-installer-extract', destination: path.resolve('out'), file: path.resolve('installer.jar'), sha256: 'a'.repeat(64), size: 10 };
  assert.deepEqual(parseInstallerArchiveRequest(request), request);
  for (const value of [{ ...request, entries: ['other'] }, { ...request, command: 'java' }, { ...request, file: 'relative' }, { ...request, size: 0 }]) assert.throws(() => parseInstallerArchiveRequest(value));
  assert.deepEqual(parseInstallerArchiveReply({ version: 1, kind: 'loader-installer-result', files: 3, bytes: 9 }), { version: 1, kind: 'loader-installer-result', files: 3, bytes: 9 });
  assert.throws(() => parseInstallerArchiveReply({ version: 1, kind: 'loader-installer-result', files: 2, bytes: 9 }));
});
