import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractNativeArchives } from '../src/services/install/native-archive.js';
import type { NativeArchiveInput } from '../src/services/install/native-archive.js';

interface ZipEntry {
  name: string | Buffer; body?: Buffer; deflate?: boolean; flags?: number; crc?: number; declaredSize?: number;
  external?: number; extra?: Buffer; suffix?: Buffer;
}

test('actual linked source parents and destination directories never redirect native extraction', async () => fixture(async (root, output, archive) => {
  const input = await archive(zip([{ name: 'native.dll', body: Buffer.from('fixture') }]));
  const alias = path.join(root, 'alias'); await symlink(output, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(extractNativeArchives(alias, [input]), { code: 'UNSAFE_ARCHIVE' }); }
  finally { await unlink(alias); }
  const sourceAlias = path.join(root, 'source-alias'); await symlink(root, sourceAlias, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(extractNativeArchives(output, [{ ...input, file: path.join(sourceAlias, path.basename(input.file)) }]), { code: 'UNSAFE_ARCHIVE' }); }
  finally { await unlink(sourceAlias); }
  assert.deepEqual(await readdir(output), []);
}));
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name); const body = entry.body ?? Buffer.alloc(0);
    const compressed = Buffer.concat([entry.deflate ? deflateRawSync(body) : body, entry.suffix ?? Buffer.alloc(0)]);
    const flags = entry.flags ?? 0x800; const method = entry.deflate ? 8 : 0; const extra = entry.extra ?? Buffer.alloc(0);
    const checksum = entry.crc ?? crc32(body); const size = entry.declaredSize ?? body.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!(flags & 8)) { local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size, 22); }
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
    const descriptor = Buffer.alloc(flags & 8 ? 16 : 0);
    if (descriptor.length) { descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(checksum, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(size, 12); }
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(entry.external ?? 0, 38); central.writeUInt32LE(offset, 42);
    const bytes = Buffer.concat([local, name, extra, compressed, descriptor]); locals.push(bytes); offset += bytes.length;
    centrals.push(Buffer.concat([central, name, extra]));
  }
  const central = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
async function fixture(work: (root: string, output: string, archive: (bytes: Buffer, exclude?: string[]) => Promise<NativeArchiveInput>) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-native-')); const output = path.join(root, 'output'); await mkdir(output); let next = 0;
  try {
    await work(root, output, async (bytes, exclude = []) => {
      const file = path.join(root, `${next++}.jar`); await writeFile(file, bytes);
      return { file, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, exclude };
    });
  } finally {
    const resolved = path.resolve(root); assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('oucl-native-')); await rm(resolved, { recursive: true, force: true });
  }
}

test('native archives extract stored/deflated files, UTF8, descriptors and empty directories with exclusions', async () => fixture(async (_root, output, archive) => {
  const first = await archive(zip([{ name: 'org/', deflate: true }, { name: 'org/a.dll', body: Buffer.from('stored') },
    { name: 'META-INF/MANIFEST.MF', body: Buffer.from('excluded') }, { name: 'skip.bin', body: Buffer.from('skipped') }]), ['skip']);
  const second = await archive(zip([{ name: 'org/b.dll', body: Buffer.from('deflated'), deflate: true, flags: 0x808 }, { name: '测试.txt', body: Buffer.from('utf8') },
    { name: 'META-INF/MANIFEST.MF', body: Buffer.from('another excluded manifest') }]));
  assert.deepEqual(await extractNativeArchives(output, [first, second]), { files: 3, bytes: 18 });
  assert.equal(await readFile(path.join(output, 'org', 'a.dll'), 'utf8'), 'stored');
  assert.equal(await readFile(path.join(output, 'org', 'b.dll'), 'utf8'), 'deflated');
  assert.deepEqual((await readdir(output)).sort(), ['org', '测试.txt']);
}));

test('native archive original SHA256 and size are mandatory before creating any output', async () => fixture(async (_root, output, archive) => {
  const input = await archive(zip([{ name: 'a.dll', body: Buffer.from('valid') }]));
  await assert.rejects(extractNativeArchives(output, [{ ...input, sha256: '0'.repeat(64) }]), { code: 'HASH_MISMATCH' });
  await assert.rejects(extractNativeArchives(output, [{ ...input, size: input.size + 1 }]), { code: 'HASH_MISMATCH' });
  assert.deepEqual(await readdir(output), []);
}));

test('native archives reject traversal, Windows aliases and noncanonical names before writing', async () => fixture(async (_root, output, archive) => {
  for (const name of ['../a.dll', '/a.dll', 'C:/a.dll', 'a\\b.dll', 'a/../b', 'CON', 'name.', 'name ', 'a//b']) {
    const input = await archive(zip([{ name, body: Buffer.from('bad') }]));
    await assert.rejects(extractNativeArchives(output, [input]), { code: 'UNSAFE_ARCHIVE' });
    assert.deepEqual(await readdir(output), []);
  }
}));

test('native archives reject unknown filename encoding and malformed UTF8', async () => fixture(async (_root, output, archive) => {
  for (const entry of [{ name: Buffer.from([0xff]), flags: 0 }, { name: Buffer.from([0xc0, 0xaf]), flags: 0x800 }]) {
    await assert.rejects(extractNativeArchives(output, [await archive(zip([entry]))]), { code: 'UNSAFE_ARCHIVE' });
  }
  assert.deepEqual(await readdir(output), []);
}));

test('native archives reject symlink, special file, reparse and Unix hardlink metadata', async () => fixture(async (_root, output, archive) => {
  for (const fields of [{ external: 0xa1ff0000 }, { external: 0x21ff0000 }, { external: 0x400 }, { extra: Buffer.from([0x0d, 0, 0, 0]) }]) {
    await assert.rejects(extractNativeArchives(output, [await archive(zip([{ name: 'a.dll', body: Buffer.from('target'), ...fields }]))]), { code: 'UNSAFE_ARCHIVE' });
  }
  assert.deepEqual(await readdir(output), []);
}));

test('native archives reject duplicates, case collisions and file/directory conflicts across all archives before writes', async () => fixture(async (_root, output, archive) => {
  for (const names of [['a.dll', 'a.dll'], ['A.dll', 'a.dll'], ['folder', 'folder/b.dll'], ['Folder/a.dll', 'folder/b.dll']]) {
    const inputs = await Promise.all(names.map(name => archive(zip([{ name, body: Buffer.from('x') }]))));
    await assert.rejects(extractNativeArchives(output, inputs), { code: 'UNSAFE_ARCHIVE' });
    assert.deepEqual(await readdir(output), []);
  }
  const duplicate = await archive(zip([{ name: 'a.dll' }, { name: 'A.dll' }]));
  await assert.rejects(extractNativeArchives(output, [duplicate]), { code: 'UNSAFE_ARCHIVE' });
}));

test('native archive CRC, declared output and fully consumed deflate bytes are verified', async () => fixture(async (_root, output, archive) => {
  const entries: ZipEntry[] = [
    { name: 'crc.dll', body: Buffer.from('bad CRC'), crc: 5 },
    { name: 'bomb.dll', body: Buffer.alloc(2 * 1024 ** 2), deflate: true, declaredSize: 8 },
    { name: 'tail.dll', body: Buffer.from('deflate'), deflate: true, suffix: Buffer.from('trailing garbage') },
    { name: 'META-INF/hidden', body: Buffer.from('excluded but corrupt'), crc: 3 },
  ];
  for (const entry of entries) {
    await assert.rejects(extractNativeArchives(output, [await archive(zip([entry]))]), { code: 'INVALID_ARCHIVE' });
    assert.deepEqual(await readdir(output), []);
  }
}));

test('native archive limits reject excessive per-entry, aggregate and entry-count budgets before writes', async () => fixture(async (_root, output, archive) => {
  const large = await archive(zip([{ name: 'large', deflate: true, declaredSize: 64 * 1024 ** 2 + 1 }]));
  await assert.rejects(extractNativeArchives(output, [large]), { code: 'ARCHIVE_LIMIT' });
  const aggregate = await archive(zip(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.dll`, deflate: true, declaredSize: 64 * 1024 ** 2 }))));
  await assert.rejects(extractNativeArchives(output, [aggregate]), { code: 'ARCHIVE_LIMIT' });
  const many = await archive(zip(Array.from({ length: 4097 }, (_, i) => ({ name: `${i}.dll` }))));
  await assert.rejects(extractNativeArchives(output, [many]), { code: 'ARCHIVE_LIMIT' });
  assert.deepEqual(await readdir(output), []);
}));

test('native archive header disagreement, unsupported flags, ZIP64 and overlapping local records are refused', async () => fixture(async (_root, output, archive) => {
  const flags = zip([{ name: 'a.dll', flags: 0x801 }]);
  const zip64 = zip([{ name: 'a.dll', extra: Buffer.from([1, 0, 0, 0]) }]);
  const disagreement = zip([{ name: 'a.dll', body: Buffer.from('x') }]); disagreement.writeUInt32LE(999, 14);
  const overlap = zip([{ name: 'a.dll' }, { name: 'b.dll' }]);
  const central = overlap.readUInt32LE(overlap.length - 6); overlap.writeUInt32LE(0, central + 46 + 5 + 42);
  for (const bytes of [flags, zip64, disagreement, overlap]) {
    await assert.rejects(extractNativeArchives(output, [await archive(bytes)])); assert.deepEqual(await readdir(output), []);
  }
}));

test('native extraction requires an empty destination and never overwrites player files', async () => fixture(async (_root, output, archive) => {
  await writeFile(path.join(output, 'player.txt'), 'keep');
  await assert.rejects(extractNativeArchives(output, [await archive(zip([{ name: 'player.txt', body: Buffer.from('replace') }]))]), { code: 'UNSAFE_ARCHIVE' });
  assert.equal(await readFile(path.join(output, 'player.txt'), 'utf8'), 'keep');
}));

test('native extraction errors are fixed codes without filesystem paths', async () => fixture(async (root, output) => {
  const file = path.join(root, 'private-missing.jar');
  await assert.rejects(extractNativeArchives(output, [{ file, sha256: '0'.repeat(64), size: 22, exclude: [] }]), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'HASH_MISMATCH'); assert.equal(error.message.includes(root), false); return true;
  });
}));
