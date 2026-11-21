import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkLocalMods } from '../src/core/mods/check.js';
import { checkPlatformMods } from '../src/core/mods/platform.js';
import type { PlatformModVersion } from '../src/core/mods/platform.js';
import { parseJsonModDeclarations } from '../src/core/mods/json-declarations.js';
import { ModMaintenancePreviewService } from '../src/services/mods/maintenance-preview.js';
import { presentMaintenancePreview } from '../src/services/mods/maintenance-presentation.js';
import type { MaintenancePreviewContext, MaintenancePreviewInput } from '../src/services/mods/maintenance-preview.js';
import { ModInspectionService } from '../src/services/mods/inspection.js';
import type { ModInspection } from '../src/services/mods/inspection.js';
import { ModInventoryService, modInventoryFingerprint } from '../src/services/mods/inventory.js';
import type { ModInventoryItem } from '../src/services/mods/inventory.js';
import { platformFacts } from '../src/services/mods/facts.js';
import { ModArchiveReader } from '../src/services/workers/mod-archive-reader.js';
import { modZip } from './fixtures/mod-zip.js';

const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
function source(file: ModInventoryItem): PlatformModVersion {
  return { projectId: 'project1', versionId: 'version1', name: 'Some Mod', versionNumber: '1', release: 'release',
    publishedAt: '2026-11-10T00:00:00.000Z', loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_and_server',
    dependencies: [], files: [{ filename: file.filename, size: file.size!, sha1: file.sha1!, sha512: file.sha512!,
      url: 'https://example.invalid/fixture', primary: true }], evidence: { url: 'https://example.invalid/metadata', sha256: 'a'.repeat(64) } };
}
function fixture() {
  const context: MaintenancePreviewContext = { rootId, inventory: { instanceId, revision: 4, modsDirectory: 'private-main-owned-directory',
    environment: { loader: 'fabric', versions: { minecraft: '1.20.1', java: '17' }, languageVersions: {} } } };
  const item: ModInventoryItem = { fileId: 'f'.repeat(64), filename: 'some.jar', enabled: true, size: 10,
    sha1: 'a'.repeat(40), sha256: 'b'.repeat(64), sha512: 'c'.repeat(128), issues: [],
    archives: [{ entries: [], jarJar: false, declarations: [parseJsonModDeclarations('fabric', JSON.stringify({ schemaVersion: 1, id: 'some_mod', version: '1' }))] }] };
  const local = checkLocalMods([item], context.inventory.environment);
  const inspected: ModInspection = { inventory: { instanceId, revision: 4, fingerprint: modInventoryFingerprint(instanceId, 4, [item]), items: [item], local },
    platform: checkPlatformMods(local.state, platformFacts([item]), context.inventory.environment, new Map([[item.sha512!, source(item)]])), platformFailures: [] };
  const input: MaintenancePreviewInput = { rootId, instanceId, expectedRevision: 4, expectedFingerprint: inspected.inventory.fingerprint,
    fileId: item.fileId, action: 'disable' };
  return { context, inspected, input };
}
test('private preview binds the requested root, instance and exact inventory and returns no filesystem path', async () => {
  const f = fixture(); const initial = structuredClone(f);
  const service = new ModMaintenancePreviewService(async () => f.context, { check: async () => f.inspected });
  const result = await service.preview(f.input);
  assert.equal(result.impact.state, 'ready'); assert.equal(result.filename, 'some.jar'); assert.equal(result.rootId, rootId);
  assert.ok(!JSON.stringify(result).includes(f.context.inventory.modsDirectory));
  result.impact.affectedProviders[0]!.id = 'changed'; assert.deepEqual(f, initial);
});
test('root drift, wrong instance and stale revisions stop before a preview can be returned', async () => {
  for (const change of ['root', 'instance', 'revision', 'environment', 'directory'] as const) {
    const f = fixture(); let reads = 0;
    const service = new ModMaintenancePreviewService(async () => {
      const context = structuredClone(f.context);
      if (++reads === 2) {
        if (change === 'root') context.rootId = instanceId;
        if (change === 'instance') context.inventory.instanceId = rootId;
        if (change === 'revision') context.inventory.revision++;
        if (change === 'environment') context.inventory.environment.versions.java = '21';
        if (change === 'directory') context.inventory.modsDirectory = 'other-main-owned-directory';
      }
      return context;
    }, { check: async () => f.inspected });
    await assert.rejects(service.preview(f.input), { code: change === 'root' ? 'ROOT_UNAVAILABLE' : 'REVISION_CONFLICT' });
  }
});
test('same filename fileId is not sufficient after content changes, including inconsistent internal fingerprints', async () => {
  for (const recompute of [true, false]) {
    const f = fixture(); f.inspected.inventory.items[0]!.sha256 = 'd'.repeat(64);
    if (recompute) f.inspected.inventory.fingerprint = modInventoryFingerprint(instanceId, 4, f.inspected.inventory.items);
    const service = new ModMaintenancePreviewService(async () => f.context, { check: async () => f.inspected });
    await assert.rejects(service.preview(f.input), { code: 'FILES_CHANGED' });
  }
});
test('a platform transport failure cannot become ready by disabling the last JAR', async () => {
  const f = fixture(); f.inspected.platformFailures = ['NETWORK_FAILED'];
  const result = await new ModMaintenancePreviewService(async () => f.context, { check: async () => f.inspected }).preview(f.input);
  assert.equal(result.impact.state, 'unknown'); assert.deepEqual(result.platformFailures, ['NETWORK_FAILED']);
});
test('admission and cancellation join the ongoing scan boundary and release the private lane afterwards', async () => {
  const f = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const inside = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  const service = new ModMaintenancePreviewService(async () => f.context, { check: async () => { entered(); await gate; return f.inspected; } });
  const request = structuredClone(f.input); const pending = service.preview(request, controller.signal); await inside;
  request.rootId = instanceId; // Caller edits cannot change the in-flight selection.
  await assert.rejects(service.preview(f.input), { code: 'SCAN_BUSY' });
  let finished = false; void pending.catch(() => { finished = true; }); controller.abort();
  await Promise.resolve(); assert.equal(finished, false); release(); await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal((await service.preview(f.input)).impact.state, 'ready');
});
test('invalid selectors cause no context or inspection side effects', async () => {
  const f = fixture(); let effects = 0;
  const service = new ModMaintenancePreviewService(async () => { effects++; return f.context; }, { check: async () => { effects++; return f.inspected; } });
  for (const input of [{ ...f.input, rootId: '../private' }, { ...f.input, instanceId: '../private' },
    { ...f.input, expectedRevision: 0 }, { ...f.input, expectedFingerprint: 'old-report' }, { ...f.input, fileId: 'filename.jar' }]) {
    await assert.rejects(service.preview(input), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(effects, 0);
});
test('real two-scan inventory and JAR worker preview never rename or rewrite a local JAR', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-maintenance-preview-')); await mkdir(path.join(directory, 'mods'));
  const f = fixture(); f.context.inventory.modsDirectory = path.join(directory, 'mods');
  const bytes = modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'some_mod', version: '1' })]]);
  const target = path.join(directory, 'mods', 'some.jar'); await writeFile(target, bytes);
  const context = async () => structuredClone(f.context.inventory);
  const inventory = new ModInventoryService(context, new ModArchiveReader(new URL('../src/services/workers/entry.js', import.meta.url)));
  const first = await inventory.scan(instanceId, 4); const current = first.items[0]!;
  const inspection = new ModInspectionService(context, inventory, { byHashes: async () => new Map([[current.sha512!, source(current)]]) });
  const service = new ModMaintenancePreviewService(async () => f.context, inspection);
  const input = { ...f.input, expectedFingerprint: first.fingerprint, fileId: current.fileId };
  const preview = await service.preview(input);
  assert.equal(preview.impact.state, 'ready');
  const display = presentMaintenancePreview(preview);
  assert.equal(display.state, 'ready'); assert.equal(display.providers[0]!.id, 'some_mod');
  assert.ok(!JSON.stringify(display).includes('https://example.invalid'));
  assert.deepEqual(await readdir(path.dirname(target)), ['some.jar']); assert.deepEqual(await readFile(target), bytes);
  await writeFile(target, modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'changed_mod', version: '2' })]]));
  await assert.rejects(service.preview(input), { code: 'FILES_CHANGED' });
});
