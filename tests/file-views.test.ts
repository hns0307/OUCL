import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileViewService } from '../src/services/install/file-views.js';
import { ObjectStore } from '../src/services/objects/store.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import type { IndexedObject } from '../src/services/storage/object-index.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const body = Buffer.from('immutable shared library');
const spec = { url: 'https://libraries.minecraft.net/fixture.jar',
  expected: { algorithm: 'sha1' as const, digest: createHash('sha1').update(body).digest('hex'), size: body.length, provenanceId: 'fixture:library' },
  anchor: { kind: 'mojang-version' as const, algorithm: 'sha1' as const, digest: 'a'.repeat(40) } };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-file-view-')); const storeRoot = path.join(root, 'store'); const view = path.join(root, 'view');
  await mkdir(storeRoot); await mkdir(view); const pool = new HashPool(entry); const index = new Map<string, IndexedObject>();
  const objects = await ObjectStore.open(storeRoot, { async lookup(key) { return index.get(key); }, async remember(key, object) { index.set(key, object); }, async clear() { index.clear(); } }, pool);
  const stage = await objects.createStaging(); await writeFile(stage.file, body); const object = await objects.commit(stage.id, spec.expected, spec.anchor);
  const source = path.join(storeRoot, 'objects', 'sha256', object.digest.slice(0, 2), object.digest);
  return { root, storeRoot, view, pool, objects, object, source,
    async close() { await objects.close(); await pool.close(); await rm(root, { recursive: true, force: true }); } };
}

test('verified copy views preserve shared objects, validate receipts and reject unknown existing entries', async () => {
  const f = await fixture();
  try {
    const service = new FileViewService(f.storeRoot, f.objects, f.pool);
    const receipt = await service.materialize(f.view, 'org/example/a.jar', spec, f.object, { mode: 'copy' });
    assert.equal(receipt.mode, 'copy'); assert.deepEqual(await readFile(path.join(f.view, receipt.relativePath)), body);
    assert.deepEqual(await service.materialize(f.view, receipt.relativePath, spec, f.object, { mode: 'copy', existing: receipt }), receipt);
    await assert.rejects(service.materialize(f.view, receipt.relativePath, spec, f.object, { mode: 'copy' }), { code: 'VIEW_CONFLICT' });
    await chmod(path.join(f.view, receipt.relativePath), 0o666); await writeFile(path.join(f.view, receipt.relativePath), 'corrupted');
    await assert.rejects(service.materialize(f.view, receipt.relativePath, spec, f.object, { mode: 'copy', existing: receipt }), { code: 'NEEDS_RECOVERY' });
    assert.deepEqual(await readFile(f.source), body);
  } finally { await f.close(); }
});

test('file-link privilege failure explicitly returns a checked copy without changing system policy', async () => {
  const f = await fixture(); let attempts = 0;
  try {
    const service = new FileViewService(f.storeRoot, f.objects, f.pool, async () => { attempts++; throw Object.assign(new Error('PRIVATE_PATH'), { code: 'EPERM' }); });
    const receipt = await service.materialize(f.view, 'fallback.jar', spec, f.object, { mode: 'prefer-link' });
    assert.equal(attempts, 1); assert.equal(receipt.mode, 'copy'); assert.deepEqual(await readFile(path.join(f.view, receipt.relativePath)), body);
  } finally { await f.close(); }
});

test('unknown linked parents and target entries are rejected without touching their external target', async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.root, 'outside'); await mkdir(outside);
    const alias = path.join(f.view, 'alias'); await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const service = new FileViewService(f.storeRoot, f.objects, f.pool);
    await assert.rejects(service.materialize(f.view, 'alias/a.jar', spec, f.object, { mode: 'copy' }), { code: 'NEEDS_RECOVERY' });
    await assert.rejects(service.materialize(f.view, 'alias', spec, f.object, { mode: 'copy' }), { code: 'VIEW_CONFLICT' });
    await unlink(alias); assert.deepEqual(await readFile(f.source), body);
  } finally { await f.close(); }
});

test('cancellation and invalid source facts create no new file and missing recorded projections require recovery', async () => {
  const f = await fixture();
  try {
    const service = new FileViewService(f.storeRoot, f.objects, f.pool);
    await assert.rejects(service.materialize(f.view, '../escape.jar', spec, f.object, { mode: 'copy' }), { code: 'INVALID_VIEW' });
    await assert.rejects(service.materialize(f.view, 'cancel.jar', spec, f.object, { mode: 'copy', signal: AbortSignal.abort() }), { code: 'CANCELLED' });
    await assert.rejects(service.materialize(f.view, 'missing.jar', spec, { ...f.object, digest: '0'.repeat(64) }, { mode: 'copy' }), { code: 'NEEDS_RECOVERY' });
    await assert.rejects(service.materialize(f.view, 'missing.jar', spec, f.object, { mode: 'copy', existing: { relativePath: 'missing.jar', objectDigest: f.object.digest, size: f.object.size, mode: 'copy' } }), { code: 'NEEDS_RECOVERY' });
  } finally { await f.close(); }
});

test('real preferred file projection reports actual link capability and deletion preserves the object', async () => {
  const f = await fixture();
  try {
    const service = new FileViewService(f.storeRoot, f.objects, f.pool);
    const receipt = await service.materialize(f.view, 'preferred.jar', spec, f.object, { mode: 'prefer-link' });
    const target = path.join(f.view, receipt.relativePath);
    assert.equal((await lstat(target)).isSymbolicLink(), receipt.mode === 'symlink');
    assert.deepEqual(await service.materialize(f.view, receipt.relativePath, spec, f.object, { mode: 'prefer-link', existing: receipt }), receipt);
    if (receipt.mode === 'copy') await chmod(target, 0o666);
    await unlink(target); assert.deepEqual(await readFile(f.source), body);
  } finally { await f.close(); }
});

test('a recorded copy replaced by a hard link never acquires copy ownership', async () => {
  const f = await fixture();
  try {
    const target = path.join(f.view, 'copy.jar'); await link(f.source, target);
    const service = new FileViewService(f.storeRoot, f.objects, f.pool);
    await assert.rejects(service.materialize(f.view, 'copy.jar', spec, f.object, { mode: 'copy', existing: {
      relativePath: 'copy.jar', objectDigest: f.object.digest, size: f.object.size, mode: 'copy'
    } }), { code: 'NEEDS_RECOVERY' });
    await unlink(target); assert.deepEqual(await readFile(f.source), body);
  } finally { await f.close(); }
});

test('concurrent same-target creation serializes and refuses silent overwrite', async () => {
  const f = await fixture();
  try {
    const service = new FileViewService(f.storeRoot, f.objects, f.pool);
    const results = await Promise.allSettled([service.materialize(f.view, 'same.jar', spec, f.object, { mode: 'copy' }), service.materialize(f.view, 'same.jar', spec, f.object, { mode: 'copy' })]);
    assert.equal(results[0]!.status, 'fulfilled'); assert.equal(results[1]!.status, 'rejected');
    if (results[1]!.status === 'rejected') assert.equal((results[1]!.reason as { code: string }).code, 'VIEW_CONFLICT');
  } finally { await f.close(); }
});
