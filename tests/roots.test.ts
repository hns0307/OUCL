import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, rm, rmdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RootService } from '../src/services/roots/service.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { isRootsRequest, isRootsResult, rootsFailure } from '../src/shared/contracts/roots.js';
import { handleRoots } from '../src/ipc/roots.js';
import { isHandshakeResult } from '../src/shared/contracts/handshake.js';
import { negotiateHandshake } from '../src/ipc/handshake.js';

const id = '00000000-0000-4000-8000-000000000001';
const trace = '00000000-0000-4000-8000-000000000002';
const request = { contractVersion: 1, requestId: id, payload: {} };
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
interface Fixture { base: string; metadata: string; selected: string; client: StorageClient; service: RootService }
async function fixture(work: (f: Fixture) => Promise<void>): Promise<void> {
  const base = await mkdtemp(path.join(tmpdir(), 'oucl-roots-')); const metadata = path.join(base, 'metadata'); const selected = path.join(base, '游戏 数据');
  await mkdir(metadata); await mkdir(selected);
  const client = await StorageClient.open(entry, metadata);
  const f = { base, metadata, selected, client, service: new RootService(client, [metadata]) };
  try { await work(f); } finally { await f.client.close(); await rm(base, { recursive: true, force: true }); }
}

test('root request schema accepts only an empty payload and valid correlated envelope', async () => {
  assert.ok(isRootsRequest(request));
  for (const invalid of [null, [], { ...request, extra: true }, { ...request, payload: { directory: 'C:/private' } }, { ...request, contractVersion: 2 }, { ...request, requestId: '../path' }]) assert.equal(isRootsRequest(invalid), false);
  let calls = 0;
  const action = async () => { calls++; return { items: [] }; };
  for (const [input, trusted, code] of [[request, false, 'INVALID_SENDER'], [{ ...request, payload: { directory: 'secret' } }, true, 'INVALID_ARGUMENT'], [{ ...request, contractVersion: 2 }, true, 'UNSUPPORTED_CONTRACT']] as const) {
    const result = await handleRoots(input, trusted, trace, action);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, code);
    assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(isRootsResult(result, result.requestId, 'list'));
  }
  assert.equal(calls, 0);
});

test('root results enforce labels, exact keys, channel schema and fixed error mapping', () => {
  const result = { contractVersion: 1, requestId: id, ok: true, data: { items: [{ rootId: id, label: '游戏目录 1', available: true }] } };
  assert.ok(isRootsResult(result, id, 'list')); assert.equal(isRootsResult(result, trace, 'list'), false); assert.equal(isRootsResult(result, id, 'choose'), false);
  assert.equal(isRootsResult({ ...result, data: { items: [{ rootId: id, label: 'C:/Users/private', available: true }] } }, id, 'list'), false);
  assert.equal(isRootsResult({ ...result, data: { items: [{ rootId: id, label: '游戏目录 1', available: true, directory: 'secret' }] } }, id, 'list'), false);
  assert.ok(isRootsResult({ ...result, data: { selection: 'cancelled' } }, id, 'choose'));
  const error = rootsFailure(id, 'PERMISSION_DENIED', trace);
  assert.ok(isRootsResult(error, id, 'choose'));
  if (!error.ok) assert.equal(isRootsResult({ ...error, error: { ...error.error, stack: 'private' } }, id, 'choose'), false);
  const handshake = negotiateHandshake({ ...request, payload: { supportedVersions: [1] } }, true, id, trace, ['roots.v1']);
  assert.ok(isHandshakeResult(handshake, id));
});

test('directory cancellation changes no registration and leaks no selected local path', async () => fixture(async f => {
  assert.deepEqual(await f.service.list(), { items: [] });
  assert.deepEqual(await f.service.choose(async () => undefined), { selection: 'cancelled' });
  assert.equal(await f.client.readInstallation(), undefined);
  assert.equal((await readdir(f.selected)).length, 0);
}));

test('native-adapter selection persists once and survives a storage-worker restart', async () => fixture(async f => {
  const selected = await f.service.choose(async () => f.selected); assert.equal(selected.selection, 'chosen');
  assert.ok(!JSON.stringify(selected).includes(f.selected));
  assert.equal((await readdir(f.selected)).length, 0);
  const stored = await f.client.readInstallation(); assert.ok(stored);
  await f.client.close(); f.client = await StorageClient.open(entry, f.metadata); f.service = new RootService(f.client, [f.metadata]);
  assert.equal((await f.service.list()).items[0]?.rootId, stored.data.rootId);
  assert.deepEqual(await f.service.choose(async () => { throw new Error('must not reopen dialog for fixed registration'); }), selected);
  const output = await handleRoots(request, true, trace, () => f.service.list());
  assert.ok(isRootsResult(output, id, 'list')); assert.ok(!JSON.stringify(output).includes(f.selected));
}));

test('portable default is created only for a fresh installation and never replaces an existing selection', async () => fixture(async f => {
  const portable = path.join(f.base, 'OUCL.games'); const first = await f.service.ensureDefault(portable);
  assert.equal(first.selection, 'chosen'); assert.equal((await f.client.readInstallation())?.data.dataDirectory, await realpath(portable));
  const other = path.join(f.base, 'other'); await mkdir(other);
  assert.deepEqual(await f.service.ensureDefault(other), first);
  assert.equal((await f.client.readInstallation())?.data.dataDirectory, await realpath(portable));
  assert.deepEqual(await readdir(f.base).then(items => items.includes('other')), true);
}));

test('application directories, their ancestors and linked selections are rejected', async () => fixture(async f => {
  for (const selected of [f.metadata, f.base]) await assert.rejects(f.service.choose(async () => selected), { code: 'ROOT_OUT_OF_SCOPE' });
  const alias = path.join(f.base, 'alias'); await symlink(f.selected, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.choose(async () => alias), { code: 'ROOT_OUT_OF_SCOPE' });
  assert.equal(await f.client.readInstallation(), undefined);
}));

test('concurrent directory requests share one native selection and one stable record', async () => fixture(async f => {
  let calls = 0; let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = f.service.choose(async () => { calls++; await gate; return f.selected; });
  const second = f.service.choose(async () => { calls++; return f.metadata; });
  assert.equal(first, second); release();
  assert.deepEqual(await first, await second); assert.equal(calls, 1);
  assert.equal((await f.client.readInstallation())?.revision, 1);
}));

test('disconnected directory is retained and shown unavailable rather than silently replaced', async () => fixture(async f => {
  await f.service.choose(async () => f.selected); await rmdir(f.selected);
  assert.equal((await f.service.list()).items[0]?.available, false);
  assert.ok(await f.client.readInstallation());
}));
