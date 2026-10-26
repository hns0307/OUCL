import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { InstallerPreparationService } from '../src/services/loaders/installer-preparation.js';
import { ObjectStore } from '../src/services/objects/store.js';
import { FileViewService } from '../src/services/install/file-views.js';
import { extractSelectedArchive } from '../src/services/install/native-archive.js';
import { INSTALLER_ENTRIES } from '../src/services/workers/installer-archive-protocol.js';

function archive(): Buffer {
  const files = [['install_profile.json', '{"spec":1}'], ['version.json', '{"id":"fixture"}'], ['data/client.lzma', 'patch']];
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [nameValue, bodyValue] of files) {
    const name = Buffer.from(nameValue!); const body = Buffer.from(bodyValue!); const checksum = crc32(body);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42); central.push(entry, name); offset += header.length + name.length + body.length;
  }
  const center = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, center, end]);
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-loader-prepare-')); const index = new Map<string, { digest: string; size: number }>();
  const hash = { hash: async (file: string) => { const body = await readFile(file); return { size: body.length,
    sha1: createHash('sha1').update(body).digest('hex'), sha256: createHash('sha256').update(body).digest('hex') }; } };
  const objects = await ObjectStore.open(root, { lookup: async key => index.get(key), remember: async (key, object) => { index.set(key, object); }, clear: async () => { index.clear(); } }, hash);
  const body = archive(); const url = 'https://maven.minecraftforge.net/fixture/installer.jar';
  const spec = { url, expected: { algorithm: 'sha1' as const, digest: createHash('sha1').update(body).digest('hex'), size: body.length, provenanceId: 'loader:fixture' },
    anchor: { kind: 'loader-maven' as const, algorithm: 'sha256' as const, digest: 'a'.repeat(64) } };
  const staged = await objects.createStaging(); await writeFile(staged.file, body); const object = await objects.commit(staged.id, spec.expected, spec.anchor);
  const service = new InstallerPreparationService({ prepare: async () => { throw new Error('not called during reopen'); } },
    { catalog: async () => { throw new Error('not called during reopen'); } }, { resolve: async () => { throw new Error('not called during reopen'); } });
  let extractions = 0;
  const runtime = { dataDirectory: root, objects, views: new FileViewService(root, objects, hash),
    coordinator: { request: () => { throw new Error('reopen must use committed object'); } },
    extractor: { run: async (destination: string, input: { file: string; sha256: string; size: number }) => {
      extractions++; const result = await extractSelectedArchive(destination, input, INSTALLER_ENTRIES);
      return { files: 3 as const, bytes: result.bytes };
    } } };
  const loader = { installer: { sourceUrl: url, spec, object }, profileBody: '{"spec":1}', versionBody: '{"id":"fixture"}' };
  return { root, service, runtime, loader, stats: () => extractions,
    close: async () => { await objects.close(); assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); } };
}

test('reopen revalidates shared object bytes and re-extracts exact documents into a fresh private tree', async () => {
  const f = await fixture(); try {
    const first = await f.service.reopen(f.loader, f.runtime, new AbortController().signal);
    const second = await f.service.reopen(f.loader, f.runtime, new AbortController().signal);
    assert.notEqual(first.workspace, second.workspace); assert.equal(first.profileBody, f.loader.profileBody); assert.equal(f.stats(), 2);
    assert.equal(await readFile(path.join(first.workspace, 'installer/data/client.lzma'), 'utf8'), 'patch');
    await assert.rejects(f.service.reopen({ ...f.loader, profileBody: '{"spec":2}' }, f.runtime, new AbortController().signal), { code: 'NEEDS_RECOVERY' });
  } finally { await f.close(); }
});

test('reopen refuses changed object identity and cancellation before extraction', async () => {
  const f = await fixture(); try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.service.reopen(f.loader, f.runtime, controller.signal), { code: 'CANCELLED' });
    await assert.rejects(f.service.reopen({ ...f.loader, installer: { ...f.loader.installer,
      object: { ...f.loader.installer.object, digest: '0'.repeat(64) } } }, f.runtime, new AbortController().signal), { code: 'NEEDS_RECOVERY' });
    assert.equal(f.stats(), 0);
  } finally { await f.close(); }
});
