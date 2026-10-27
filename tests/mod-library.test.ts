import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ModLibraryReader } from '../src/services/mods/library.js';
import { ModArchiveReader } from '../src/services/workers/mod-archive-reader.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import type { ResourceRecord } from '../src/services/storage/resources.js';
import type { PlatformModVersion } from '../src/core/mods/platform.js';
import { modZip } from './fixtures/mod-zip.js';
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const projectId = 'RootProj'; const versionId = 'RootVer1';
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-mod-library-')); const games = path.join(directory, 'games'); await mkdir(games);
  const metadata = path.join(directory, 'metadata'); await mkdir(metadata); const storage = await StorageClient.open(entry, metadata);
  const rootId = randomUUID(); await storage.createInstallation({ rootId, dataDirectory: games });
  const bytes = modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'actual_mod', version: '1.2.3' })]]);
  const sha1 = createHash('sha1').update(bytes).digest('hex'); const sha256 = createHash('sha256').update(bytes).digest('hex'); const sha512 = createHash('sha512').update(bytes).digest('hex');
  const spec = { url: `https://cdn.modrinth.com/data/${projectId}/versions/${versionId}/actual.jar`,
    expected: { algorithm: 'sha1' as const, digest: sha1, size: bytes.length, provenanceId: `modrinth:${projectId}:${versionId}:${sha1}` },
    anchor: { kind: 'modrinth-version' as const, algorithm: 'sha256' as const, digest: 'c'.repeat(64) } };
  const record: ResourceRecord = { taskId: randomUUID(), projectId, versionId, fileId: sha1, filename: 'actual.jar', kind: 'mod', title: 'Actual', versionName: 'Platform label',
    size: bytes.length, downloaded: true, spec, object: { digest: sha256, size: bytes.length, sourceKey: sourceKey(spec.expected, spec.anchor) } };
  const file = path.join(games, 'store/objects/sha256', sha256.slice(0, 2), sha256); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
  await storage.writeResources(0, { rootId, items: [record] });
  const version: PlatformModVersion = { projectId, versionId, name: 'Platform label', versionNumber: 'NOT_A_JAR_VERSION', release: 'release',
    publishedAt: '2026-01-01T00:00:00Z', loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_and_server', dependencies: [],
    files: [{ filename: 'actual.jar', url: spec.url, size: bytes.length, primary: true, sha1, sha512 }], evidence: { url: `https://api.modrinth.com/v2/version/${versionId}`, sha256: 'c'.repeat(64) } };
  return { storage, rootId, file, bytes, record, version, input: { projectId, versionId, fileId: sha1 } };
}
test('library reader rehashes a real JAR, keeps its actual declared version and never changes its bytes', async () => {
  const state = await fixture();
  try {
    const reader = new ModLibraryReader(state.storage, new ModArchiveReader(entry), { version: async () => state.version });
    const result = await reader.read(state.input);
    assert.equal(result.scan.archives[0]?.declarations[0]?.mods[0]?.id, 'actual_mod'); assert.equal(result.scan.archives[0]?.declarations[0]?.mods[0]?.version, '1.2.3');
    assert.equal(result.version.versionNumber, 'NOT_A_JAR_VERSION'); assert.deepEqual(await readFile(state.file), state.bytes);
    assert.deepEqual((await state.storage.readResources())!.data.items, [state.record]);
    await assert.rejects(reader.read({ ...state.input, fileId: 'a'.repeat(40) }), { code: 'NOT_FOUND' });
    await assert.rejects(reader.read({ ...state.input, projectId: '../path' }), { code: 'INVALID_ARGUMENT' });
  } finally { await state.storage.close(); }
});
test('corrupt cached bytes and conflicting SHA512 platform evidence cannot authorize a root', async () => {
  const state = await fixture();
  try {
    const reader = new ModLibraryReader(state.storage, new ModArchiveReader(entry), { version: async () => ({ ...state.version, files: [{ ...state.version.files[0]!, sha512: 'f'.repeat(128) }] }) });
    await assert.rejects(reader.read(state.input), { code: 'UNTRUSTED_METADATA' });
    await writeFile(state.file, 'corrupt jar'); await assert.rejects(reader.read(state.input), { code: 'MODS_UNSAFE' });
  } finally { await state.storage.close(); }
});
test('changed library records and files invalidate an observation after the platform read', async () => {
  const state = await fixture();
  try {
    const scanner = new ModArchiveReader(entry);
    const changed = new ModLibraryReader(state.storage, scanner, { version: async () => {
      await state.storage.writeResources(1, { rootId: state.rootId, items: [{ ...state.record, title: 'Changed externally' }] }); return state.version;
    } });
    await assert.rejects(changed.read(state.input), { code: 'FILES_CHANGED' });
    const fileChanged = new ModLibraryReader(state.storage, scanner, { version: async () => { await writeFile(state.file, 'external edit'); return state.version; } });
    await assert.rejects(fileChanged.read(state.input), { code: 'FILES_CHANGED' });
  } finally { await state.storage.close(); }
});
test('unready resources, wrong source ownership and project substitutions stay controlled', async () => {
  const state = await fixture();
  try {
    const reader = new ModLibraryReader(state.storage, new ModArchiveReader(entry), { version: async () => ({ ...state.version, projectId: 'WrongOne' }) });
    await assert.rejects(reader.read(state.input), { code: 'UNTRUSTED_METADATA' });
    await state.storage.writeResources(1, { rootId: state.rootId, items: [{ ...state.record, object: { ...state.record.object!, sourceKey: 'd'.repeat(64) } }] });
    await assert.rejects(reader.read(state.input), { code: 'UNTRUSTED_METADATA' });
    const unready = { ...state.record, downloaded: false }; delete unready.object;
    await state.storage.writeResources(2, { rootId: state.rootId, items: [unready] }); await assert.rejects(reader.read(state.input), { code: 'NOT_FOUND' });
  } finally { await state.storage.close(); }
});
test('cancellation waits for the in-flight source read and a reader refuses concurrent admissions', async () => {
  const state = await fixture(); let release!: () => void; let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const abort = new AbortController();
  try {
    const reader = new ModLibraryReader(state.storage, new ModArchiveReader(entry), { version: async () => { began(); await gate; return state.version; } });
    const pending = reader.read(state.input, abort.signal); await started; await assert.rejects(reader.read(state.input), { code: 'SCAN_BUSY' });
    abort.abort(); release(); await assert.rejects(pending, { code: 'CANCELLED' }); assert.deepEqual(await readFile(state.file), state.bytes);
  } finally { release(); await state.storage.close(); }
});
