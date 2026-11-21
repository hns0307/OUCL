import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ModInventoryService } from '../src/services/mods/inventory.js';
import type { ModInventoryContext } from '../src/services/mods/inventory.js';
import { ModArchiveReader } from '../src/services/workers/mod-archive-reader.js';
import { ModArchiveError } from '../src/services/mods/archive.js';
import { modZip } from './fixtures/mod-zip.js';
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const instanceId = '00000000-0000-4000-8000-000000000001';
async function fixture(): Promise<ModInventoryContext> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-mod-inventory-'));
  return { instanceId, revision: 4, modsDirectory: path.join(root, 'mods'),
    environment: { loader: 'fabric', versions: { minecraft: '1.20.1', java: '17' }, languageVersions: {} } };
}
const jar = (id: string, extra: Record<string, unknown> = {}): Buffer => modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id, version: '1', ...extra })]]);

test('instance inventory reads local hashes and disabled files without creating directories or changing JARs', async () => {
  const context = await fixture(); const reader = new ModArchiveReader(entry); const service = new ModInventoryService(async () => context, reader);
  const empty = await service.scan(instanceId, 4); assert.equal(empty.items.length, 0); assert.equal(empty.local.state, 'satisfied');
  await assert.rejects(access(context.modsDirectory), { code: 'ENOENT' });
  await mkdir(context.modsDirectory);
  await writeFile(path.join(context.modsDirectory, 'consumer.jar'), jar('consumer_mod', { depends: { library_mod: '*' } }));
  await writeFile(path.join(context.modsDirectory, 'library.jar.disabled'), jar('library_mod'));
  await writeFile(path.join(context.modsDirectory, 'note.txt'), 'player private note');
  const result = await service.scan(instanceId, 4); assert.equal(result.items.length, 2); assert.equal(result.local.state, 'unsatisfied');
  assert.ok(result.items.every(item => item.sha512?.length === 128)); assert.equal(result.items[1]!.enabled, false);
  assert.equal((await service.scan(instanceId, 4)).fingerprint, result.fingerprint);
  await rename(path.join(context.modsDirectory, 'library.jar.disabled'), path.join(context.modsDirectory, 'library.jar'));
  const enabled = await service.scan(instanceId, 4); assert.equal(enabled.local.state, 'satisfied'); assert.notEqual(enabled.fingerprint, result.fingerprint);
});
test('scan preserves controlled unreadable/corrupt/unsafe entries as unknown evidence', async () => {
  const context = await fixture(); await mkdir(context.modsDirectory);
  await writeFile(path.join(context.modsDirectory, 'broken.jar'), 'broken archive'); await mkdir(path.join(context.modsDirectory, 'directory.jar'));
  const result = await new ModInventoryService(async () => context, new ModArchiveReader(entry)).scan(instanceId, 4);
  assert.equal(result.local.state, 'unknown'); assert.ok(result.items[0]!.issues.includes('INVALID_ARCHIVE'));
  assert.ok(result.items[1]!.issues.includes('UNSAFE_ARCHIVE')); assert.equal(result.items[1]!.sha256, null);
});
test('file content, directory inventory and instance revision changes invalidate the observation', async () => {
  const context = await fixture(); await mkdir(context.modsDirectory); const target = path.join(context.modsDirectory, 'mod.jar');
  await writeFile(target, jar('some_mod')); const reader = new ModArchiveReader(entry);
  const changing = new ModInventoryService(async () => context, { read: async (file, signal) => {
    const result = await reader.read(file, signal); await writeFile(file, jar('changed_mod')); return result;
  } });
  await assert.rejects(changing.scan(instanceId, 4), { code: 'FILES_CHANGED' });
  const adding = new ModInventoryService(async () => context, { read: async (file, signal) => {
    const result = await reader.read(file, signal); await writeFile(path.join(context.modsDirectory, 'new.jar'), jar('new_mod')); return result;
  } });
  await assert.rejects(adding.scan(instanceId, 4), { code: 'FILES_CHANGED' });
  let reads = 0;
  const revised = new ModInventoryService(async () => ({ ...context, revision: ++reads === 1 ? 4 : 5 }), reader);
  await assert.rejects(revised.scan(instanceId, 4), { code: 'REVISION_CONFLICT' });
  await assert.rejects(revised.scan(instanceId, 1), { code: 'REVISION_CONFLICT' });
});
test('inventory admission, cancellation and entry count are bounded', async () => {
  const context = await fixture(); await mkdir(context.modsDirectory); await writeFile(path.join(context.modsDirectory, 'mod.jar'), jar('some_mod'));
  const reader = new ModArchiveReader(entry); const controller = new AbortController();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = new ModInventoryService(async () => context, { read: async (file, signal) => {
    await gate; if (signal?.aborted) throw new ModArchiveError('CANCELLED'); return reader.read(file, signal);
  } });
  const active = slow.scan(instanceId, 4, controller.signal);
  await assert.rejects(slow.scan(instanceId, 4), { code: 'SCAN_BUSY' }); controller.abort(); release();
  await assert.rejects(active, { code: 'CANCELLED' });
  await assert.rejects(slow.scan(instanceId, 4, controller.signal), { code: 'CANCELLED' });
  await assert.rejects(slow.scan('../bad', 4), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(slow.scan(instanceId, 0), { code: 'INVALID_ARGUMENT' });
  await Promise.all(Array.from({ length: 256 }, (_, i) => writeFile(path.join(context.modsDirectory, `${i}.jar`), 'x')));
  await assert.rejects(slow.scan(instanceId, 4), { code: 'MOD_LIMIT' });
});
