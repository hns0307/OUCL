import assert from 'node:assert/strict';
import test from 'node:test';
import { ModInspectionService } from '../src/services/mods/inspection.js';
import type { ModInventory, ModInventoryContext } from '../src/services/mods/inventory.js';
import { ModPlatformError } from '../src/services/mods/modrinth.js';
import type { PlatformModVersion } from '../src/core/mods/platform.js';
const instanceId = '00000000-0000-4000-8000-000000000001'; const sha512 = 'a'.repeat(128);
const context: ModInventoryContext = { instanceId, revision: 1, modsDirectory: 'private', environment: { loader: 'fabric', versions: { minecraft: '1.20.1' }, languageVersions: {} } };
const inventory = (): ModInventory => ({ instanceId, revision: 1, fingerprint: 'b'.repeat(64), items: [{ fileId: 'c'.repeat(64), enabled: true, filename: 'example.jar',
  size: 100, sha1: 'd'.repeat(40), sha256: 'e'.repeat(64), sha512, issues: [], archives: [{ entries: [], declarations: [{ format: 'fabric',
    mods: [], nested: [], language: null, issues: [] }], jarJar: false }] }], local: { state: 'satisfied', issues: [], providers: [] } });
const version: PlatformModVersion = { projectId: 'project1', versionId: 'version1', name: 'Example', versionNumber: 'label', release: 'release', publishedAt: '2026-10-20T00:00:00Z',
  loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_or_server', dependencies: [], files: [{ filename: 'example.jar', size: 100, sha1: 'd'.repeat(40), sha512,
    primary: true, url: 'https://cdn.modrinth.com/data/project1/versions/version1/example.jar' }], evidence: { url: 'https://api.modrinth.com/v2/version/version1', sha256: 'f'.repeat(64) } };
test('inspection binds real hash requests to two stable local observations and reports progress', async () => {
  let reads = 0; const stages: string[] = [];
  const service = new ModInspectionService(async () => context, { scan: async () => { reads++; return inventory(); } }, { byHashes: async hashes => {
    assert.deepEqual(hashes, [sha512]); return new Map([[sha512, version]]);
  } });
  const result = await service.check(instanceId, 1, undefined, async stage => { stages.push(stage); });
  assert.equal(reads, 2); assert.equal(result.platform.state, 'satisfied'); assert.deepEqual(result.platformFailures, []);
  assert.deepEqual(stages, ['local', 'platform', 'rechecking', 'completed']);
});
test('platform outage remains explicit unknown and does not erase the local report', async () => {
  const service = new ModInspectionService(async () => context, { scan: async () => inventory() }, { byHashes: async () => { throw new ModPlatformError('NETWORK_FAILED'); } });
  const result = await service.check(instanceId, 1); assert.equal(result.platform.state, 'unknown'); assert.equal(result.inventory.local.state, 'satisfied');
  assert.deepEqual(result.platformFailures, ['NETWORK_FAILED']);
});
test('network-time file changes or environment revisions invalidate the check', async () => {
  let reads = 0;
  const changed = new ModInspectionService(async () => context, { scan: async () => ({ ...inventory(), fingerprint: String(++reads) }) }, { byHashes: async () => new Map() });
  await assert.rejects(changed.check(instanceId, 1), { code: 'FILES_CHANGED' });
  let contexts = 0;
  const revised = new ModInspectionService(async () => ({ ...context, revision: ++contexts }), { scan: async () => inventory() }, { byHashes: async () => new Map() });
  await assert.rejects(revised.check(instanceId, 1), { code: 'REVISION_CONFLICT' });
});
test('inspection cancellation joins platform calls and prevents concurrent scans', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const controller = new AbortController();
  const service = new ModInspectionService(async () => context, { scan: async () => inventory() }, { byHashes: async () => { await gate; throw new ModPlatformError('CANCELLED'); } });
  const pending = service.check(instanceId, 1, controller.signal);
  await assert.rejects(service.check(instanceId, 1), { code: 'SCAN_BUSY' }); controller.abort(); release();
  await assert.rejects(pending, { code: 'CANCELLED' });
  await assert.rejects(service.check(instanceId, 1, controller.signal), { code: 'CANCELLED' });
  await assert.rejects(service.check('../path', 1), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(service.check(instanceId, 0), { code: 'INVALID_ARGUMENT' });
});
