import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { InstallerService } from '../src/services/install/installer.js';
import type { InstallMetadataService } from '../src/services/catalog/install-metadata.js';
import type { JavaPackage } from '../src/services/java/runtime.js';
import { ObjectStore } from '../src/services/objects/store.js';
import type { StorageClient } from '../src/services/workers/storage-client.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { NativeExtractor } from '../src/services/workers/native-extractor.js';
import { InstallerArchiveExtractor } from '../src/services/workers/installer-archive-extractor.js';

const BASE = process.env.A02_ROOT ?? await mkdtemp(path.join(tmpdir(), 'oucl-installer-runtime-'));
const rootId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const index = { lookup: async () => undefined, remember: async () => {}, clear: async () => {} };
const hasher = { hash: async () => { throw new Error('UNEXPECTED_HASH'); } };
const code = (error: unknown): string => typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
const fakePack = (digest: string): JavaPackage => ({ digest, files: [] } as unknown as JavaPackage);

test('failed shared initialization drains, retries once after real owner closes, reuses one runtime and closes normally', async () => {
  const root = await mkdtemp(path.join(BASE!, 'case-')); const dataDirectory = path.join(root, 'games');
  const store = path.join(dataDirectory, 'store'); await mkdir(store, { recursive: true });
  const owner = await ObjectStore.open(store, index, hasher); let ownerClosed = false;
  const ownerFile = path.join(store, 'objects.owner.lock'); const initialOwner = await readFile(ownerFile, 'utf8');
  let registrations = 0; let signalRead!: () => void; let releaseRead!: () => void;
  const entered = new Promise<void>(resolve => { signalRead = resolve; });
  const gate = new Promise<void>(resolve => { releaseRead = resolve; });
  const storage = { ...index, async readInstallation() { registrations++; if (registrations === 1) { signalRead(); await gate; }
    return { data: { rootId, dataDirectory } }; }, async readInstance() { return undefined; } } as unknown as StorageClient;
  const service = new InstallerService(storage, path.join(root, 'unused-worker.cjs'), null as unknown as InstallMetadataService);
  const signal = new AbortController().signal;
  try {
    const one = service.prepareJava(fakePack('a'.repeat(64)), taskId, signal);
    const two = service.prepareJava(fakePack('b'.repeat(64)), taskId, signal);
    await entered; assert.equal(registrations, 1, 'concurrent consumers must share initialization'); releaseRead();
    const failed = await Promise.allSettled([one, two]);
    assert.deepEqual(failed.map(result => result.status === 'rejected' ? code(result.reason) : 'RESOLVED'), ['STORE_BUSY', 'STORE_BUSY']);
    assert.equal(await readFile(ownerFile, 'utf8'), initialOwner, 'the other owner is untouched');
    await owner.close(); ownerClosed = true;
    const retry = await Promise.allSettled([service.prepareLaunch(taskId, 1, signal)]);
    console.log(JSON.stringify({ observation: 'after-owner-normal-close', firstErrors: ['STORE_BUSY', 'STORE_BUSY'], retryError: retry[0]?.status === 'rejected' ? code(retry[0].reason) : 'RESOLVED', registrations }));
    assert.equal(retry[0]?.status, 'rejected');
    if (retry[0]?.status === 'rejected') assert.equal(code(retry[0].reason), 'INSTANCE_NOT_FOUND', 'retry must get past shared runtime initialization');
    const paths = await Promise.all([service.prepareJava(fakePack('a'.repeat(64)), taskId, signal), service.prepareJava(fakePack('b'.repeat(64)), taskId, signal)]);
    assert.notEqual(paths[0], paths[1]); assert.equal(registrations, 2, 'one successful runtime reused');
    await assert.rejects(ObjectStore.open(store, index, hasher), error => code(error) === 'STORE_BUSY');
    await service.close(); await service.close();
    const successor = await ObjectStore.open(store, index, hasher); await successor.close();
    await assert.rejects(service.prepareJava(fakePack('c'.repeat(64)), taskId, signal));
    console.log(JSON.stringify({ observation: 'fixed-runtime-closed', registrations, externalOwnerUntouched: true, successorOwnerClosedNormally: true }));
  } finally {
    releaseRead(); if (!ownerClosed) await owner.close(); await service.close();
  }
});

test('failed initialization remains shared until delayed cleanup actually settles', async () => {
  const root = await mkdtemp(path.join(BASE!, 'delayed-')); const dataDirectory = path.join(root, 'games');
  const store = path.join(dataDirectory, 'store'); await mkdir(store, { recursive: true });
  const owner = await ObjectStore.open(store, index, hasher);
  let reads = 0; let began!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const original = HashPool.prototype.close;
  HashPool.prototype.close = async function () { began(); await gate; await original.call(this); };
  const storage = { ...index, async readInstallation() { reads++; return { data: { rootId, dataDirectory } }; } } as unknown as StorageClient;
  const service = new InstallerService(storage, path.join(root, 'unused-worker.cjs'), null as unknown as InstallMetadataService);
  const signal = new AbortController().signal; let ownerClosed = false;
  try {
    const first = service.prepareJava(fakePack('d'.repeat(64)), taskId, signal);
    await entered; await owner.close(); ownerClosed = true;
    const second = service.prepareJava(fakePack('e'.repeat(64)), taskId, signal);
    const settled = Promise.allSettled([first, second]);
    await Promise.resolve(); assert.equal(reads, 1, 'must not start another runtime before cleanup ends');
    release(); const outcomes = await settled;
    assert.deepEqual(outcomes.map(result => result.status === 'rejected' ? code(result.reason) : 'RESOLVED'), ['STORE_BUSY', 'STORE_BUSY']);
    HashPool.prototype.close = original;
    await service.prepareJava(fakePack('f'.repeat(64)), taskId, signal); assert.equal(reads, 2);
    console.log(JSON.stringify({ observation: 'cleanup-before-retry', reads, bothConsumersSharedFailure: true }));
  } finally {
    release(); HashPool.prototype.close = original; if (!ownerClosed) await owner.close(); await service.close();
  }
});

test('simultaneous retries after a failed owner claim share one successful runtime', async () => {
  const root = await mkdtemp(path.join(BASE!, 'concurrent-retry-')); const dataDirectory = path.join(root, 'games');
  const store = path.join(dataDirectory, 'store'); await mkdir(store, { recursive: true });
  const owner = await ObjectStore.open(store, index, hasher); let ownerClosed = false; let reads = 0;
  let entered!: () => void; let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const storage = { ...index, async readInstallation() { reads++; if (reads === 2) { entered(); await gate; }
    return { data: { rootId, dataDirectory } }; } } as unknown as StorageClient;
  const service = new InstallerService(storage, path.join(root, 'unused-worker.cjs'), null as unknown as InstallMetadataService);
  const signal = new AbortController().signal;
  try {
    await assert.rejects(service.prepareJava(fakePack('a'.repeat(64)), taskId, signal), error => code(error) === 'STORE_BUSY');
    await owner.close(); ownerClosed = true;
    const first = service.prepareJava(fakePack('b'.repeat(64)), taskId, signal);
    const second = service.prepareJava(fakePack('c'.repeat(64)), taskId, signal);
    await waiting; assert.equal(reads, 2); release();
    const values = await Promise.all([first, second]); assert.notEqual(values[0], values[1]); assert.equal(reads, 2);
    await assert.rejects(ObjectStore.open(store, index, hasher), error => code(error) === 'STORE_BUSY');
    await service.close(); const successor = await ObjectStore.open(store, index, hasher); await successor.close();
    console.log(JSON.stringify({ observation: 'concurrent-successful-retry', reads, returned: values.length, successorOwnerClosedNormally: true }));
  } finally { release(); if (!ownerClosed) await owner.close(); await service.close(); }
});

test('cleanup failure drains other resources and keeps the failed cache closed to retries', async () => {
  const root = await mkdtemp(path.join(BASE!, 'cleanup-fail-')); const dataDirectory = path.join(root, 'games');
  const store = path.join(dataDirectory, 'store'); await mkdir(store, { recursive: true });
  const owner = await ObjectStore.open(store, index, hasher); let ownerClosed = false; let reads = 0;
  const hashClose = HashPool.prototype.close; const nativeClose = NativeExtractor.prototype.close;
  const installerClose = InstallerArchiveExtractor.prototype.close; const observed: string[] = [];
  HashPool.prototype.close = async function () { observed.push('hash'); await hashClose.call(this); };
  NativeExtractor.prototype.close = async function () { observed.push('native'); await nativeClose.call(this); throw new Error('CLEANUP_INJECTED'); };
  InstallerArchiveExtractor.prototype.close = async function () { observed.push('installer'); await installerClose.call(this); };
  const storage = { ...index, async readInstallation() { reads++; return { data: { rootId, dataDirectory } }; } } as unknown as StorageClient;
  const service = new InstallerService(storage, path.join(root, 'unused-worker.cjs'), null as unknown as InstallMetadataService);
  const signal = new AbortController().signal;
  try {
    await assert.rejects(service.prepareJava(fakePack('a'.repeat(64)), taskId, signal), error => code(error) === 'NEEDS_RECOVERY');
    assert.deepEqual([...observed].sort(), ['hash', 'installer', 'native']);
    await owner.close(); ownerClosed = true;
    await assert.rejects(service.prepareJava(fakePack('b'.repeat(64)), taskId, signal), error => code(error) === 'NEEDS_RECOVERY');
    assert.equal(reads, 1, 'unsafe failed cleanup must not admit a new runtime');
    console.log(JSON.stringify({ observation: 'failed-cleanup-stays-closed', attempted: observed, reads }));
  } finally {
    HashPool.prototype.close = hashClose; NativeExtractor.prototype.close = nativeClose; InstallerArchiveExtractor.prototype.close = installerClose;
    if (!ownerClosed) await owner.close(); await service.close();
  }
});

test('service close joins in-flight failure cleanup and prevents later initialization', async () => {
  const root = await mkdtemp(path.join(BASE!, 'close-inflight-')); const dataDirectory = path.join(root, 'games');
  const store = path.join(dataDirectory, 'store'); await mkdir(store, { recursive: true });
  const owner = await ObjectStore.open(store, index, hasher); const original = HashPool.prototype.close;
  let began!: () => void; let release!: () => void; let reads = 0; let closed = false;
  const entered = new Promise<void>(resolve => { began = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  HashPool.prototype.close = async function () { began(); await gate; await original.call(this); };
  const storage = { ...index, async readInstallation() { reads++; return { data: { rootId, dataDirectory } }; } } as unknown as StorageClient;
  const service = new InstallerService(storage, path.join(root, 'unused-worker.cjs'), null as unknown as InstallMetadataService);
  try {
    const pending = service.prepareJava(fakePack('a'.repeat(64)), taskId, new AbortController().signal);
    const rejected = assert.rejects(pending, error => code(error) === 'STORE_BUSY');
    await entered;
    const closing = service.close().then(() => { closed = true; });
    await assert.rejects(service.prepareJava(fakePack('b'.repeat(64)), taskId, new AbortController().signal), error => code(error) === 'INSTALL_FAILED');
    assert.equal(closed, false); assert.equal(reads, 1);
    release(); await rejected; await closing; assert.equal(closed, true);
    await assert.rejects(service.prepareJava(fakePack('c'.repeat(64)), taskId, new AbortController().signal), error => code(error) === 'INSTALL_FAILED');
    console.log(JSON.stringify({ observation: 'close-joins-cleanup', reads, ownerPreserved: true }));
  } finally { release(); HashPool.prototype.close = original; await owner.close(); await service.close(); }
});
