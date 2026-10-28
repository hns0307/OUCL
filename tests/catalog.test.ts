import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isOfficialMetadataUrl, parseManifest } from '../src/core/version/manifest.js';
import { CatalogService } from '../src/services/catalog/service.js';
import { CatalogError, MANIFEST_URL, OfficialMetadataReader } from '../src/services/catalog/transport.js';
import { parseCatalogCache } from '../src/services/storage/catalog-cache.js';
import type { CatalogCache } from '../src/services/storage/catalog-cache.js';
import type { RecordEnvelope } from '../src/services/storage/records.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { catalogFailure, isCatalogQuery, isCatalogResult } from '../src/shared/contracts/catalog.js';
import { handleCatalog } from '../src/ipc/catalog.js';

const stamp = '2026-10-24T00:00:00.000Z'; const now = Date.parse(stamp);
const descriptor = { id: '1.21.1', mainClass: 'net.minecraft.client.main.Main', javaVersion: { majorVersion: 21 },
  downloads: { client: { url: 'https://piston-data.mojang.com/client.jar', sha1: 'c'.repeat(40), size: 10 } }, libraries: [] };
const descriptorBody = JSON.stringify(descriptor); const sha1 = createHash('sha1').update(descriptorBody).digest('hex');
const url = `https://piston-meta.mojang.com/v1/packages/${sha1}/1.21.1.json`;
const entry = { id: '1.21.1', type: 'release', url, sha1, releaseTime: stamp };
const manifest = { versions: [entry, { ...entry, id: '1.20.1' }, { ...entry, id: 'snapshot', type: 'snapshot' }, { ...entry, id: 'alpha', type: 'old_alpha' }] };
const body = JSON.stringify(manifest);
function cache(text = body, fetchedAt = stamp): CatalogCache { return { body: text, fetchedAt, sha256: createHash('sha256').update(text).digest('hex') }; }
class MemoryRepository {
  value: RecordEnvelope<CatalogCache> | undefined;
  async readCatalog(): Promise<RecordEnvelope<CatalogCache> | undefined> { return this.value; }
  async writeCatalog(revision: number, data: CatalogCache): Promise<RecordEnvelope<CatalogCache>> {
    assert.equal(this.value?.revision ?? 0, revision);
    this.value = { schemaVersion: 1, revision: revision + 1, data: parseCatalogCache(data) }; return this.value;
  }
}
const request: typeof fetch = async input => new Response(String(input) === MANIFEST_URL ? body : descriptorBody);

test('official manifest parser bounds entries, identities, hashes, timestamps and origins', () => {
  assert.equal(parseManifest(manifest).length, 4);
  assert.ok(isOfficialMetadataUrl(MANIFEST_URL)); assert.ok(isOfficialMetadataUrl(url));
  assert.ok(isOfficialMetadataUrl(url.replace('piston-meta', 'launchermeta')));
  const historical = { ...entry, id: '3D Shareware v1.34', url: url.replace('1.21.1.json', '3D%20Shareware%20v1.34.json') };
  assert.equal(parseManifest({ versions: [historical] })[0]?.id, historical.id);
  assert.equal(isOfficialMetadataUrl(url.replace('1.21.1.json', '%2fescape.json')), false);
  assert.equal(isOfficialMetadataUrl(url.replace('1.21.1.json', '%zz.json')), false);
  for (const invalid of ['not a url', 'http://piston-meta.mojang.com/mc/game/version_manifest_v2.json', url + '?x=1', url + '#hash', url.replace('https://', 'https://user:pass@'), url.replace('.com/', '.com:8443/'), url.replace('piston-meta.mojang.com', 'evil.example'), 'https://piston-meta.mojang.com/other']) assert.equal(isOfficialMetadataUrl(invalid), false);
  for (const invalid of [null, {}, { versions: [] }, { versions: Array(20001).fill(entry) }, { versions: [entry, entry] },
    ...[{ id: '../x' }, { type: 'unknown' }, { url: 'https://evil.example/x' }, { sha1: 'bad' }, { releaseTime: 'not a timestamp' }, { releaseTime: '2026-99-99T00:00:00Z' }].map(change => ({ versions: [{ ...entry, ...change }] }))]) assert.throws(() => parseManifest(invalid));
});

test('metadata HTTPS reader refuses origins, status, oversized bodies and wrong SHA1', async () => {
  const reader = new OfficialMetadataReader(request);
  assert.equal((await reader.read(url, sha1)).sha1, sha1);
  await assert.rejects(reader.read('https://evil.example/'), { code: 'UNTRUSTED_MANIFEST' });
  await assert.rejects(reader.read(url, 'bad'), { code: 'UNTRUSTED_MANIFEST' });
  await assert.rejects(reader.read(url, '0'.repeat(40)), { code: 'UNTRUSTED_MANIFEST' });
  for (const response of [new Response('offline', { status: 503 }), new Response(null, { status: 200 })]) {
    await assert.rejects(new OfficialMetadataReader(async () => response).read(MANIFEST_URL), { code: 'CATALOG_UNAVAILABLE' });
  }
  for (const response of [new Response('{}', { headers: { 'content-length': '9999999999' } }), new Response('{}', { headers: { 'content-length': 'bad' } }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    await assert.rejects(new OfficialMetadataReader(async () => response).read(MANIFEST_URL), { code: 'UNTRUSTED_MANIFEST' });
  }
  await assert.rejects(new OfficialMetadataReader(async () => new Response(new Uint8Array([255]))).read(MANIFEST_URL), { code: 'UNTRUSTED_MANIFEST' });
  await assert.rejects(new OfficialMetadataReader(async () => { throw new Error('private network exception'); }).read(MANIFEST_URL), { code: 'CATALOG_UNAVAILABLE' });
});

test('catalog paginates by source revision and does not claim runtime compatibility', async () => {
  const repository = new MemoryRepository(); const service = new CatalogService(new OfficialMetadataReader(request), repository, () => now);
  const page = await service.list({ channel: 'release', limit: 1 });
  assert.equal(page.page.items[0]?.status, 'candidate'); assert.equal(page.cached, false); assert.ok(page.page.nextCursor);
  const second = await service.list({ channel: 'release', limit: 1, cursor: page.page.nextCursor });
  assert.equal(second.cached, true);
  assert.equal(second.page.items[0]?.mcVersionId, '1.20.1'); assert.equal(second.page.nextCursor, undefined);
  assert.equal((await service.list({ channel: 'old', limit: 10 })).page.items[0]?.type, 'old_alpha');
  assert.equal((await service.list({ channel: 'snapshot', limit: 10 })).page.items.length, 1);
  for (const query of [{ channel: 'release' as const, limit: 0 }, { channel: 'release' as const, limit: 101 }, { channel: 'release' as const, limit: 1, cursor: 'bad' }, { channel: 'snapshot' as const, limit: 1, cursor: page.page.nextCursor },
    { channel: 'release' as const, limit: 1, cursor: page.page.nextCursor!.replace(/\.1$/, '.999999') }]) await assert.rejects(service.list(query), { code: 'INVALID_ARGUMENT' });
});

test('stale verified cache works offline with its original timestamp and bounded refresh retries', async () => {
  const repository = new MemoryRepository(); repository.value = { schemaVersion: 1, revision: 1, data: cache() };
  let calls = 0;
  const offline = new OfficialMetadataReader(async () => { calls++; throw new Error('offline'); });
  const service = new CatalogService(offline, repository, () => now + 600000);
  const [a, b] = await Promise.all([service.list({ channel: 'release', limit: 10 }), service.list({ channel: 'release', limit: 10 })]);
  assert.equal(a.cached, true); assert.equal(b.fetchedAt, stamp); assert.equal(calls, 3);
  await service.list({ channel: 'release', limit: 10 }); assert.equal(calls, 3);
  const fresh = new CatalogService(offline, repository, () => now + 1);
  assert.equal((await fresh.list({ channel: 'release', limit: 1 })).cached, true); assert.equal(calls, 3);
});

test('invalid cache and corrupt fresh metadata never acquire trust through fallback', async () => {
  const repository = new MemoryRepository(); repository.value = { schemaVersion: 1, revision: 1, data: { ...cache(), sha256: '0'.repeat(64) } };
  await assert.rejects(new CatalogService(new OfficialMetadataReader(request), repository, () => now).list({ channel: 'release', limit: 1 }), { code: 'UNTRUSTED_MANIFEST' });
  repository.value.data = cache();
  await assert.rejects(new CatalogService(new OfficialMetadataReader(async () => new Response('not json')), repository, () => now + 600000).list({ channel: 'release', limit: 1 }), { code: 'UNTRUSTED_MANIFEST' });
  repository.value.data = cache(body, '2099-01-01T00:00:00.000Z');
  await assert.rejects(new CatalogService(new OfficialMetadataReader(request), repository, () => now).list({ channel: 'release', limit: 1 }), { code: 'UNTRUSTED_MANIFEST' });
});

test('descriptor resolution verifies official metadata before returning the client plan and provenance', async () => {
  const service = new CatalogService(new OfficialMetadataReader(request), new MemoryRepository(), () => now);
  const resolved = await service.resolve('1.21.1', { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
  assert.equal(resolved.version.javaMajor, 21); assert.equal(resolved.metadataSha1ByVersion['1.21.1'], sha1);
  await assert.rejects(service.resolve('missing', { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} }), { code: 'INVALID_ARGUMENT' });
  const corrupt = new CatalogService(new OfficialMetadataReader(async input => new Response(String(input) === MANIFEST_URL ? body : descriptorBody + ' ')), new MemoryRepository(), () => now);
  await assert.rejects(corrupt.resolve('1.21.1', { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} }), { code: 'UNTRUSTED_MANIFEST' });
});

test('catalog IPC rejects paths/URLs and invalid senders before network access, and validates output', async () => {
  const id = '00000000-0000-4000-8000-000000000001'; const trace = '00000000-0000-4000-8000-000000000002';
  const query = { channel: 'release', limit: 20 }; let calls = 0;
  assert.ok(isCatalogQuery(query)); assert.equal(isCatalogQuery({ ...query, url: MANIFEST_URL }), false);
  const list = async () => { calls++; return { page: { items: [] }, fetchedAt: stamp, cached: false }; };
  const input = { contractVersion: 1, requestId: id, payload: query };
  assert.equal((await handleCatalog(input, false, trace, list)).ok, false);
  assert.equal((await handleCatalog({ ...input, payload: { ...query, directory: 'secret' } }, true, trace, list)).ok, false);
  assert.equal(calls, 0);
  const output = await handleCatalog(input, true, trace, list); assert.ok(isCatalogResult(output, id)); assert.equal(isCatalogResult(output, trace), false);
  assert.ok(isCatalogResult(catalogFailure(id, 'UNTRUSTED_MANIFEST', trace), id));
  assert.equal(isCatalogResult({ ...output, data: { page: { items: [{ mcVersionId: 'x', type: 'release', status: 'candidate', releaseTime: stamp, url: 'secret' }] }, fetchedAt: stamp, cached: false } }, id), false);
  const failed = await handleCatalog(input, true, trace, async () => { throw new CatalogError('UNTRUSTED_MANIFEST'); }); assert.ok(isCatalogResult(failed, id));
});

test('official catalog cache persists through real SQLite/JSON worker restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-catalog-'));
  let client = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), root);
  try {
    await new CatalogService(new OfficialMetadataReader(request), client, () => now).list({ channel: 'release', limit: 20 });
    await client.close(); client = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), root);
    const restored = await new CatalogService(new OfficialMetadataReader(async () => { throw new Error('must use fresh cache'); }), client, () => now + 1).list({ channel: 'release', limit: 20 });
    assert.equal(restored.cached, true); assert.equal(restored.page.items.length, 2); assert.equal(restored.fetchedAt, stamp);
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});
