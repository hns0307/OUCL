import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ModrinthClient } from '../src/services/resources/modrinth.js';
import { ResourceService } from '../src/services/resources/service.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { DownloadError } from '../src/services/download/types.js';
import { isResourcePayload, isResourceResult, ResourceContractError } from '../src/shared/contracts/resources.js';
import type { ResourceDispatcher, ResourceChannel } from '../src/shared/contracts/resources.js';
import { handleResources } from '../src/ipc/resources.js';
import type { DownloadSpec, TransferOptions } from '../src/services/download/types.js';

const projectId = 'abcdefgh'; const versionId = '1234ABCD'; const bytes = Buffer.from('trusted fixture');
const fileId = createHash('sha1').update(bytes).digest('hex');
const input = { projectId, versionId, fileId };
function version(url = `https://cdn.modrinth.com/data/${projectId}/versions/${versionId}/example.jar`) {
  return { id: versionId, project_id: projectId, name: 'Example 1', game_versions: ['1.20.1'], loaders: ['fabric'], files: [{ filename: 'example.jar', size: bytes.length, primary: true, hashes: { sha1: fileId }, url }] };
}
function client(override?: (url: URL) => unknown): ModrinthClient {
  return new ModrinthClient(async (request, init) => {
    const url = new URL(String(request)); assert.equal(url.origin, 'https://api.modrinth.com'); assert.equal(init?.redirect, 'error');
    const custom = override?.(url);
    if (custom instanceof Response) return custom;
    let data = custom;
    if (!data) data = url.pathname.endsWith('/search') ? { hits: [{ project_id: projectId, title: 'Example', author: 'Author', description: 'Description', downloads: 20, project_type: 'mod' }], total_hits: 1, offset: 0 }
      : url.pathname.endsWith(`/project/${projectId}`) ? { id: projectId, project_type: 'mod', title: 'Example' }
      : url.pathname.endsWith(`/project/${projectId}/version`) ? [version()] : version();
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  });
}
test('Modrinth search/version/file projection retains compatibility and re-fetches trusted source hashes', async () => {
  const api = client(url => { if (url.pathname.endsWith('/search')) { assert.deepEqual(JSON.parse(url.searchParams.get('facets')!), [['project_type:mod'], ['versions:1.20.1'], ['categories:fabric']]); } return undefined; });
  assert.equal((await api.search({ kind: 'mod', query: 'Example', gameVersion: '1.20.1', loader: 'fabric', offset: 0 })).items[0]?.projectId, projectId);
  const versions = await api.versions({ projectId, gameVersion: '1.20.1', loader: 'fabric' }); assert.equal(versions.items[0]?.files[0]?.fileId, fileId);
  assert.equal(JSON.stringify(versions).includes('https://'), false);
  const chosen = await api.select(input); assert.equal(chosen.spec.expected.digest, fileId); assert.equal(chosen.spec.anchor.kind, 'modrinth-version');
});
test('resource API rejects unsafe origins, mismatched ownership, filenames, invalid metadata and rate limits', async () => {
  await assert.rejects(client(url => url.pathname.includes('/v2/version/') ? version('https://example.com/malware.jar') : undefined).select(input), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(client(url => url.pathname.includes('/v2/version/') ? { ...version(), project_id: 'wrong123' } : undefined).select(input));
  await assert.rejects(client(url => url.pathname.includes('/v2/version/') ? { ...version(), files: [{ ...version().files[0], filename: '../bad.jar' }] } : undefined).select(input));
  const limited = client(() => new Response('', { status: 429, headers: { 'retry-after': '1' } }));
  await assert.rejects(limited.search({ kind: 'shader', query: '', gameVersion: '', loader: '', offset: 0 }), { code: 'RETRY_LATER' });
  await assert.rejects(limited.search({ kind: 'shader', query: '', gameVersion: '', loader: '', offset: 0 }), { code: 'RETRY_LATER' });
  await assert.rejects(client(() => new Response('x', { headers: { 'content-length': String(9 * 1024 ** 2) } })).versions({ projectId, gameVersion: '', loader: '' }), { code: 'NETWORK_FAILED' });
});
test('resource IPC validates sender, correlation, bounded filters and strict DTOs before effects', async () => {
  assert.ok(isResourcePayload(input, 'resources:download')); assert.equal(isResourcePayload({ ...input, url: 'https://example.com' }, 'resources:download'), false);
  assert.equal(isResourcePayload({}, 'bad' as ResourceChannel), false);
  let calls = 0; const dispatch: ResourceDispatcher = async () => { calls++; throw new Error('private path and token'); };
  const id = randomUUID(); const envelope = { contractVersion: 1, requestId: id, payload: input };
  const denied = await handleResources('resources:download', envelope, false, id, dispatch); assert.ok(!denied.ok); assert.equal(denied.error.code, 'INVALID_SENDER'); assert.equal(calls, 0);
  const failed = await handleResources('resources:download', envelope, true, id, dispatch); assert.ok(isResourceResult(failed, id, 'resources:download')); assert.equal(JSON.stringify(failed).includes('private'), false);
  const leaked = await handleResources('resources:library', { ...envelope, payload: {} }, true, id, (async () => ({ items: [], path: 'private' })) as unknown as ResourceDispatcher); assert.equal(leaked.ok, false);
  const accepted = await handleResources('resources:download', envelope, true, id, (async () => ({ taskId: id })) as unknown as ResourceDispatcher);
  assert.ok(accepted.ok); assert.ok(isResourceResult(accepted, id, 'resources:download'));
});

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
async function fixture(work: (storage: StorageClient, root: string, metadata: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-resource-test-')); const metadata = path.join(root, 'metadata'); const games = path.join(root, 'games'); await mkdir(metadata); await mkdir(games);
  const storage = await StorageClient.open(entry, metadata);
  try { await storage.createInstallation({ rootId: projectRoot, dataDirectory: games }); await work(storage, root, metadata); }
  finally { await storage.close(); assert.ok(path.basename(root).startsWith('oucl-resource-test-')); await rm(root, { recursive: true, force: true }); }
}
const projectRoot = '00000000-0000-4000-8000-000000000001';
async function settled(service: ResourceService, id: string): Promise<string> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { const result = await service.get(projectRoot, id); if (result && ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(result.snapshot.state)) return result.snapshot.state; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('RESOURCE_TASK_TIMEOUT');
}
test('download acceptance deduplicates, tasks publish only verified resources and survive worker reopen', async () => fixture(async (storage, _root, metadata) => {
  let writes = 0;
  const effects = { transferResource: async (spec: DownloadSpec, _id: string, options: TransferOptions) => { options.onProgress?.(spec.expected.size, spec.expected.size); return { digest: 'a'.repeat(64), sourceKey: 'b'.repeat(64), size: spec.expected.size }; }, materializeResource: async () => { writes++; } };
  const service = new ResourceService(storage, effects, client()); const request = randomUUID();
  const accepted = await service.download(request, input); assert.equal((await service.download(request, input)).taskId, accepted.taskId);
  assert.equal(await settled(service, accepted.taskId), 'completed'); assert.equal(writes, 1); assert.equal((await service.library()).items[0]?.downloaded, true);
  assert.equal(JSON.stringify(await service.library()).includes('https://'), false);
  await assert.rejects(service.get(randomUUID(), accepted.taskId), { code: 'NEEDS_RECOVERY' });
  await service.close(); await storage.close();
  const reopened = await StorageClient.open(entry, metadata);
  try { const next = new ResourceService(reopened, effects, client()); await next.initialize(); assert.equal((await next.library()).items[0]?.fileId, fileId); assert.equal((await next.list(projectRoot))[0]?.state, 'completed'); await next.close(); }
  finally { await reopened.close(); }
}));
test('hash failures never publish resources and an explicit retry can complete from shared bytes', async () => fixture(async storage => {
  let failing = true; let writes = 0;
  const service = new ResourceService(storage, { transferResource: async spec => { if (failing) throw new DownloadError('HASH_MISMATCH'); return { digest: 'a'.repeat(64), sourceKey: 'b'.repeat(64), size: spec.expected.size }; }, materializeResource: async () => { writes++; } }, client());
  const first = await service.download(randomUUID(), input); assert.equal(await settled(service, first.taskId), 'failed'); assert.equal(writes, 0); assert.equal((await service.library()).items[0]?.downloaded, false);
  failing = false; const retry = await service.download(randomUUID(), input); assert.notEqual(retry.taskId, first.taskId); assert.equal(await settled(service, retry.taskId), 'completed'); assert.equal(writes, 1); await service.close();
}));
test('resource cancellation waits for transfer cleanup, and interrupted ownership remains visible', async () => fixture(async storage => {
  let cleaned = false;
  const service = new ResourceService(storage, { transferResource: async (_spec, _id, options) => {
    await new Promise<void>(resolve => { if (options.signal?.aborted) resolve(); else options.signal?.addEventListener('abort', () => { resolve(); }, { once: true }); });
    cleaned = true; throw new DownloadError('CANCELLED');
  }, materializeResource: async () => { throw new Error('must not publish'); } }, client());
  const accepted = await service.download(randomUUID(), input); await service.cancel(projectRoot, accepted.taskId); assert.ok(cleaned); assert.equal(await settled(service, accepted.taskId), 'cancelled'); await service.close();
  const item = (await storage.readResources())!.data.items[0]!;
  const task = await storage.accept(projectRoot, randomUUID(), 'download', 'c'.repeat(64));
  const current = (await storage.readResources())!; await storage.writeResources(current.revision, { rootId: projectRoot, items: [...current.data.items, { ...item, taskId: task.taskId }] });
  const recovered = new ResourceService(storage, { transferResource: async () => { throw new ResourceContractError('UNAVAILABLE'); }, materializeResource: async () => {} }, client());
  await recovered.initialize(); assert.equal((await recovered.get(projectRoot, task.taskId))?.snapshot.state, 'needsRecovery'); await recovered.close();
}));
