import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, copyFile, link, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from '../src/services/objects/store.js';
import { ObjectOwnerLease } from '../src/services/objects/owner-lease.js';
import { OwnerGuard } from '../src/services/storage/owner-guard.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import type { TrustAnchor } from '../src/services/objects/provenance.js';
import type { ExpectedArtifact } from '../src/core/download/integrity.js';

const windows = { skip: process.platform !== 'win32', timeout: 15000 };
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const bytes = Buffer.from('object owner checkpoint fixture');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const expected: ExpectedArtifact = { algorithm: 'sha1', digest: createHash('sha1').update(bytes).digest('hex'), size: bytes.length, provenanceId: 'fixture:owner-checkpoint' };
const anchor: TrustAnchor = { kind: 'mojang-version', algorithm: 'sha1', digest: 'a'.repeat(40) };
const noIndex = { async lookup(): Promise<undefined> { return undefined; }, async remember(): Promise<void> {}, async clear(): Promise<void> {} };
const noHash = { async hash(): Promise<never> { throw new Error('HASH_NOT_EXPECTED'); } };
const marker = (root: string) => path.join(root, 'objects.owner.lock');
const guard = (root: string) => path.join(root, 'objects.owner.guard.sqlite');
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-object-owner-')); console.info(JSON.stringify({ fixture: root })); return root;
}
async function exists(file: string): Promise<boolean> { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function childOpen(base: string, point = 'open') {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/object-owner-child.js', import.meta.url)), base, point],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr!.on('data', b => { stderr += String(b); });
  const events: unknown[] = []; child.on('message', value => { events.push(value); }); const closed = once(child, 'close');
  const ready = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('READY_TIMEOUT')); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); reject(new Error(`CHILD_CLOSED_BEFORE_HANDSHAKE:${code}:${stderr}`)); });
    child.on('message', value => {
      if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'ready' && 'marker' in value && typeof value.marker === 'string') { clearTimeout(timer); resolve(value.marker); }
    });
  });
  return { child, ready, async exit() {
    child.send('exit-without-close'); const [code, signal] = await closed;
    console.info(JSON.stringify({ child: child.pid, code, signal, events, stderr })); assert.equal(code, 73); assert.equal(signal, null); assert.equal(stderr, '');
  } };
}

test('object-root guard recovers after controlled process exit and excludes a different profile', windows, async () => {
  const base = await fixture(); const owner = await childOpen(base); const storeRoot = path.join(base, 'store'); const metadata = path.join(base, 'metadata');
  assert.match(owner.ready, /^oucl-object-owner-v1:/);
  await assert.rejects(OwnerGuard.acquire(metadata), { code: 'STORE_BUSY' });
  await assert.rejects(ObjectStore.open(storeRoot, noIndex, noHash), { code: 'STORE_BUSY' });
  const profile2 = path.join(base, 'profile2'); await mkdir(profile2); const other = await OwnerGuard.acquire(profile2);
  try { await assert.rejects(ObjectStore.open(storeRoot.toLowerCase(), noIndex, noHash), { code: 'STORE_BUSY' }); } finally { await other.close(); }
  await owner.exit();
  const recovered = await OwnerGuard.acquire(metadata); const store = await ObjectStore.open(storeRoot, noIndex, noHash);
  try { assert.equal(await readFile(marker(storeRoot), 'utf8'), owner.ready); const staged = await store.createStaging(); assert.ok(await exists(staged.file)); }
  finally { await store.close(); await recovered.close(); }
  assert.equal(await exists(marker(storeRoot)), false);
  const reopened = await ObjectStore.open(storeRoot, noIndex, noHash); await reopened.close();
});

for (const content of ['1a04ed60-7925-4ed2-9446-0e174104edc5', 'unknown-owner-format', 'oucl-object-owner-v1:truncated']) test(`object lease preserves refused marker ${content}`, windows, async () => {
  const root = await fixture(); await writeFile(marker(root), content);
  await assert.rejects(ObjectStore.open(root, noIndex, noHash), { code: content.startsWith('oucl-object-owner-v1:') ? 'NEEDS_RECOVERY' : 'STORE_BUSY' });
  assert.equal(await readFile(marker(root), 'utf8'), content); assert.equal(await exists(guard(root)), false);
});

test('valid new marker without its guard and incomplete empty guard both fail closed', windows, async () => {
  const base = await fixture(); const owner = await childOpen(base); await owner.exit(); const root = path.join(base, 'store');
  await rename(guard(root), guard(root) + '.preserved');
  await assert.rejects(ObjectStore.open(root, noIndex, noHash), { code: 'NEEDS_RECOVERY' });
  assert.equal(await readFile(marker(root), 'utf8'), owner.ready);
  const incomplete = await fixture(); await writeFile(guard(incomplete), '');
  await assert.rejects(ObjectStore.open(incomplete, noIndex, noHash), { code: 'NEEDS_RECOVERY' });
  assert.equal((await readFile(guard(incomplete))).length, 0); assert.equal(await exists(marker(incomplete)), false);
});

for (const kind of ['replace', 'corrupt', 'hardlink'] as const) test(`preserved new marker rejects ${kind} of guard`, windows, async () => {
  const base = await fixture(); const owner = await childOpen(base); await owner.exit(); const root = path.join(base, 'store'); const file = guard(root);
  if (kind === 'replace') { await rename(file, file + '.preserved'); await copyFile(file + '.preserved', file); }
  if (kind === 'corrupt') await writeFile(file, 'corrupt guard evidence');
  if (kind === 'hardlink') await link(file, file + '.hardlink');
  const before = await readFile(file);
  await assert.rejects(ObjectStore.open(root, noIndex, noHash), { code: 'NEEDS_RECOVERY' });
  assert.deepEqual(await readFile(file), before); assert.equal(await readFile(marker(root), 'utf8'), owner.ready);
});

test('copied guard and marker cannot authorize a different root identity', windows, async () => {
  const base = await fixture(); const owner = await childOpen(base); await owner.exit(); const original = path.join(base, 'store'); const target = await fixture();
  await copyFile(guard(original), guard(target)); await copyFile(marker(original), marker(target));
  await assert.rejects(ObjectStore.open(target, noIndex, noHash), { code: 'NEEDS_RECOVERY' });
  assert.equal(await readFile(marker(target), 'utf8'), owner.ready);
});

test('the same guard inode cannot be transplanted to a different root identity', windows, async () => {
  const base = await fixture(); const owner = await childOpen(base); await owner.exit();
  const original = path.join(base, 'store'); const target = await fixture(); const before = await lstat(guard(original), { bigint: true });
  await rename(guard(original), guard(target)); await copyFile(marker(original), marker(target));
  const after = await lstat(guard(target), { bigint: true }); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev);
  await assert.rejects(ObjectStore.open(target, noIndex, noHash), { code: 'NEEDS_RECOVERY' });
  assert.equal(await readFile(marker(target), 'utf8'), owner.ready);
});

for (const suffix of ['-journal', '-wal', '-shm']) test(`orphaned object guard ${suffix} remains evidence`, windows, async () => {
  const root = await fixture(); const file = guard(root) + suffix; await writeFile(file, 'unknown evidence');
  await assert.rejects(ObjectStore.open(root, noIndex, noHash), { code: 'NEEDS_RECOVERY' });
  assert.equal(await readFile(file, 'utf8'), 'unknown evidence'); assert.equal(await exists(guard(root)), false);
});

test('guard sidecars appearing during operations or before reopen are preserved and block work', windows, async () => {
  const root = await fixture(); const store = await ObjectStore.open(root, noIndex, noHash); const original = await readFile(marker(root));
  const sidecar = guard(root) + '-journal'; await writeFile(sidecar, 'unexpected sidecar evidence');
  await assert.rejects(store.createStaging(), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(store.close(), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(ObjectStore.open(root, noIndex, noHash), { code: 'NEEDS_RECOVERY' });
  assert.equal(await readFile(sidecar, 'utf8'), 'unexpected sidecar evidence'); assert.deepEqual(await readFile(marker(root)), original);
});

test('live guard hardlink invalidates subsequent operations and close preserves the marker', windows, async () => {
  const root = await fixture(); const store = await ObjectStore.open(root, noIndex, noHash); const original = await readFile(marker(root));
  await link(guard(root), guard(root) + '.hardlink');
  await assert.rejects(store.createStaging(), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(store.close(), { code: 'NEEDS_RECOVERY' }); assert.deepEqual(await readFile(marker(root)), original);
  assert.deepEqual(await readdir(path.join(root, 'staging')), []);
});

for (const change of ['delete', 'replace'] as const) test(`marker ${change} during actual hash stops before publishing an object`, windows, async () => {
  const root = await fixture(); const hashes = new HashPool(entry); let entered!: () => void; let release!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  let remember = 0;
  const store = await ObjectStore.open(root, { ...noIndex, async remember() { remember++; } }, { async hash(file, options) {
    const result = await hashes.hash(file, options); entered(); await gate; return result;
  } });
  const staged = await store.createStaging(); await writeFile(staged.file, bytes); const original = await readFile(marker(root));
  const commit = store.commit(staged.id, expected, anchor); await Promise.race([pending, commit]);
  await rename(marker(root), marker(root) + '.preserved'); if (change === 'replace') await writeFile(marker(root), original);
  release(); await assert.rejects(commit, { code: 'NEEDS_RECOVERY' });
  assert.equal(await exists(staged.file), true); assert.equal(await exists(path.join(root, 'objects', 'sha256', sha256.slice(0, 2), sha256)), false); assert.equal(remember, 0);
  await assert.rejects(store.createStaging(), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(store.close(), { code: 'NEEDS_RECOVERY' }); await hashes.close();
  assert.deepEqual(await readFile(marker(root) + '.preserved'), original);
});

test('close drains a real commit before releasing ownership and rejects new admissions', windows, async () => {
  const root = await fixture(); const hashes = new HashPool(entry); let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const store = await ObjectStore.open(root, noIndex, hashes); const staged = await store.createStaging(); await writeFile(staged.file, bytes);
  const commit = store.commit(staged.id, expected, anchor, async point => { if (point === 'object-committed') { entered(); await gate; } });
  await Promise.race([started, commit]); const closed = store.close();
  await assert.rejects(store.createStaging(), { code: 'OBJECT_IO' });
  await assert.rejects(ObjectStore.open(root, noIndex, noHash), { code: 'STORE_BUSY' });
  release(); await commit; await closed; await hashes.close(); assert.equal(await exists(marker(root)), false);
  const again = await ObjectStore.open(root, noIndex, noHash); await again.close();
});

for (const point of ['object-committed', 'proof-committed']) test(`reacquisition after ${point} process exit never promotes orphan bytes`, windows, async () => {
  const base = await fixture(); const owner = await childOpen(base, point); await owner.exit();
  const root = path.join(base, 'store'); const client = await StorageClient.open(entry, path.join(base, 'metadata')); const hashes = new HashPool(entry);
  const store = await ObjectStore.open(root, client, hashes);
  try {
    assert.deepEqual(await readFile(path.join(root, 'objects', 'sha256', sha256.slice(0, 2), sha256)), bytes);
    assert.equal(await store.lookup(expected, anchor), undefined);
    assert.equal(await store.rebuildIndex(), point === 'proof-committed' ? 1 : 0);
    const ref = await store.lookup(expected, anchor);
    if (point === 'proof-committed') { assert.equal(ref?.digest, sha256); assert.equal(ref?.sourceKey, sourceKey(expected, anchor)); }
    else assert.equal(ref, undefined);
  } finally { await store.close(); await client.close(); await hashes.close(); }
});

test('object guard remains a separate domain from metadata guard', windows, async () => {
  const root = await fixture(); const metadata = await OwnerGuard.acquire(root); const object = await ObjectOwnerLease.acquire(root);
  try { await object.verify(); await assert.rejects(ObjectOwnerLease.acquire(root), { code: 'STORE_BUSY' }); }
  finally { await object.close(); await metadata.close(); }
});
