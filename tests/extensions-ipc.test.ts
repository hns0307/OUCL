import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OnlineToolsAdapter } from '../src/ipc/online-tools.js';
import { DistributionPreviewAdapter } from '../src/ipc/distribution-preview.js';
import { createOnlineToolsBridge } from '../src/ipc/preload-online-tools.js';
import { createDistributionBridge } from '../src/ipc/preload-distribution.js';
import { isOnlineToolsData, isOnlineToolsResult } from '../src/shared/contracts/online-tools.js';
import type { OnlineToolSnapshot, OnlineToolsResult } from '../src/shared/contracts/online-tools.js';
import { isDistributionSummary } from '../src/shared/contracts/distribution-preview.js';
import type { DistributionQuery, DistributionResult, DistributionSummary } from '../src/shared/contracts/distribution-preview.js';

const trace = randomUUID();
const trusted = (): boolean => true;
const envelope = (payload: unknown, requestId = randomUUID()) => ({ contractVersion: 1, requestId, payload });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function failure(result: OnlineToolsResult | DistributionResult, code: string): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
}
function toolsFixture() {
  let snapshot: OnlineToolSnapshot = { revision: 0, phase: 'closed' };
  const calls = { open: 0, retry: 0, close: 0 };
  const service = {
    list: () => [{ toolId: 'test-tool', title: '工具' }], state: () => snapshot,
    open: async (toolId: string) => { calls.open++; snapshot = { revision: snapshot.revision + 1, phase: 'ready', toolId }; return snapshot; },
    retry: async () => { calls.retry++; return snapshot; },
    close: async () => { calls.close++; snapshot = { revision: snapshot.revision + 1, phase: 'closed' }; return snapshot; },
  };
  return { calls, service, adapter: new OnlineToolsAdapter(service) };
}
const query = (): DistributionQuery => ({ rootId: randomUUID(), instanceId: randomUUID(), sourceId: 'club', packageId: 'pack', packageVersion: '1.0' });
function summary(input: DistributionQuery): DistributionSummary {
  return { sourceId: input.sourceId, packageId: input.packageId, packageVersion: input.packageVersion, instanceId: input.instanceId,
    revision: 1, readOnly: true, receiptStatus: 'missing', totalFiles: 1, truncated: false,
    ownership: [{ area: 'mods', path: 'example.jar', ownership: 'local-discovered' }], changes: [], conflicts: [] };
}

test('extension adapters reject untrusted documents, future versions and extra fields before invoking ports', async () => {
  const tools = toolsFixture(); let previews = 0;
  const distribution = new DistributionPreviewAdapter({ listSources: () => [], preview: async input => { previews++; return summary(input); } });
  for (const [input, trust, code] of [
    [envelope({ toolId: 'test-tool' }), () => false, 'INVALID_SENDER'],
    [{ ...envelope({ toolId: 'test-tool' }), contractVersion: 2 }, trusted, 'UNSUPPORTED_CONTRACT'],
    [envelope({ toolId: 'test-tool', url: 'https://untrusted.invalid' }), trusted, 'INVALID_ARGUMENT'],
    [{ ...envelope({ toolId: 'test-tool' }), extra: true }, trusted, 'INVALID_ARGUMENT'],
  ] as const) failure(await tools.adapter.handle('tools:open', input, trust, trace), code);
  for (const [input, trust, code] of [
    [envelope(query()), () => false, 'INVALID_SENDER'],
    [{ ...envelope(query()), contractVersion: 2 }, trusted, 'UNSUPPORTED_CONTRACT'],
    [envelope({ ...query(), publicKey: 'untrusted' }), trusted, 'INVALID_ARGUMENT'],
    [envelope({ ...query(), packageId: '../escape' }), trusted, 'INVALID_ARGUMENT'],
  ] as const) failure(await distribution.handle('distribution:preview', input, trust, trace), code);
  assert.equal(tools.calls.open, 0); assert.equal(previews, 0);
});

test('online mutations join identical identities and reject identity reuse across input or operation', async () => {
  const fixture = toolsFixture(); const request = envelope({ toolId: 'test-tool' });
  const first = await fixture.adapter.handle('tools:open', request, trusted, trace);
  assert.ok(first.ok);
  assert.deepEqual(await fixture.adapter.handle('tools:open', request, trusted, trace), first);
  failure(await fixture.adapter.handle('tools:open', { ...request, payload: { toolId: 'other-tool' } }, trusted, trace), 'REQUEST_CONFLICT');
  failure(await fixture.adapter.handle('tools:retry', { ...request, payload: {} }, trusted, trace), 'REQUEST_CONFLICT');
  assert.equal(fixture.calls.open, 1); assert.equal(fixture.calls.retry, 0);
});

test('online document invalidation closes a late view and blocks replay', async () => {
  const fixture = toolsFixture(); const gate = deferred<OnlineToolSnapshot>();
  fixture.service.open = async () => { fixture.calls.open++; return gate.promise; };
  const request = envelope({ toolId: 'test-tool' });
  const pending = fixture.adapter.handle('tools:open', request, trusted, trace);
  await fixture.adapter.dispose(); gate.resolve({ revision: 1, phase: 'ready', toolId: 'test-tool' });
  failure(await pending, 'INVALID_SENDER');
  failure(await fixture.adapter.handle('tools:open', request, trusted, trace), 'INVALID_SENDER');
  assert.equal(fixture.calls.open, 1); assert.ok(fixture.calls.close >= 2);
});

test('online mutation capacity preserves earlier identities and leaves close available', async () => {
  const fixture = toolsFixture(); const first = envelope({});
  assert.ok((await fixture.adapter.handle('tools:retry', first, trusted, trace)).ok);
  for (let index = 1; index < 128; index++) assert.ok((await fixture.adapter.handle('tools:retry', envelope({}), trusted, trace)).ok);
  failure(await fixture.adapter.handle('tools:open', envelope({ toolId: 'test-tool' }), trusted, trace), 'UNAVAILABLE');
  assert.ok((await fixture.adapter.handle('tools:retry', first, trusted, trace)).ok);
  assert.equal(fixture.calls.retry, 128);
  assert.ok((await fixture.adapter.handle('tools:close', envelope({}), trusted, trace)).ok);
});

test('online DTOs accept ordinary titles and reject controls, duplicate IDs and extra snapshot data', () => {
  const data = { tools: [{ toolId: 'test-tool', title: 'Tool status' }], snapshot: { revision: 1, phase: 'closed' } };
  assert.ok(isOnlineToolsData(data));
  assert.equal(isOnlineToolsData({ ...data, tools: [{ toolId: 'test-tool', title: 'Tool\nstatus' }] }), false);
  assert.equal(isOnlineToolsData({ ...data, tools: [data.tools[0], data.tools[0]] }), false);
  assert.equal(isOnlineToolsData({ ...data, snapshot: { ...data.snapshot, url: 'https://private.invalid' } }), false);
  assert.equal(isOnlineToolsData({ ...data, snapshot: { ...data.snapshot, code: ['LOAD_FAILED'] } }), false);
});

test('distribution previews join pending and completed jobs but reject changed target identities', async () => {
  const gate = deferred<DistributionSummary>(); let calls = 0;
  const adapter = new DistributionPreviewAdapter({ listSources: () => [], preview: async () => { calls++; return gate.promise; } });
  const input = query(); const request = envelope(input);
  const first = adapter.handle('distribution:preview', request, trusted, trace);
  const second = adapter.handle('distribution:preview', request, trusted, trace);
  failure(await adapter.handle('distribution:preview', { ...request, payload: { ...input, instanceId: randomUUID() } }, trusted, trace), 'REQUEST_CONFLICT');
  gate.resolve(summary(input)); const result = await first; assert.ok(result.ok); assert.deepEqual(await second, result);
  assert.deepEqual(await adapter.handle('distribution:preview', request, trusted, trace), result); assert.equal(calls, 1);
});

test('distribution cancellation waits for port settlement and rejects late successful preview', async () => {
  const gate = deferred<DistributionSummary>(); let signal: AbortSignal | undefined;
  const adapter = new DistributionPreviewAdapter({ listSources: () => [], preview: async (_input, current) => { signal = current; return gate.promise; } });
  const input = query(); const request = envelope(input);
  const pending = adapter.handle('distribution:preview', request, trusted, trace); let settled = false;
  const cancellation = adapter.handle('distribution:cancel', envelope({ previewRequestId: request.requestId }), trusted, trace).then(value => { settled = true; return value; });
  assert.equal(signal?.aborted, true); await Promise.resolve(); assert.equal(settled, false);
  gate.resolve(summary(input)); failure(await pending, 'CANCELLED');
  const result = await cancellation; assert.ok(result.ok); assert.deepEqual(result.data, { cancelled: true });
  failure(await adapter.handle('distribution:preview', request, trusted, trace), 'CANCELLED');
});

test('distribution disposal aborts jobs, denies late results and prevents replay', async () => {
  const gate = deferred<DistributionSummary>(); let signal: AbortSignal | undefined;
  const adapter = new DistributionPreviewAdapter({ listSources: () => [], preview: async (_input, current) => { signal = current; return gate.promise; } });
  const input = query(); const request = envelope(input); const pending = adapter.handle('distribution:preview', request, trusted, trace);
  adapter.dispose(); assert.equal(signal?.aborted, true); gate.resolve(summary(input));
  failure(await pending, 'INVALID_SENDER'); failure(await adapter.handle('distribution:preview', request, trusted, trace), 'INVALID_SENDER');
});

test('distribution jobs remain bounded and cancellation remains available at capacity', async () => {
  const adapter = new DistributionPreviewAdapter({ listSources: () => [], preview: async input => summary(input) });
  const first = envelope(query()); assert.ok((await adapter.handle('distribution:preview', first, trusted, trace)).ok);
  for (let index = 1; index < 16; index++) assert.ok((await adapter.handle('distribution:preview', envelope(query()), trusted, trace)).ok);
  failure(await adapter.handle('distribution:preview', envelope(query()), trusted, trace), 'PREVIEW_LIMIT');
  assert.ok((await adapter.handle('distribution:preview', first, trusted, trace)).ok);
  assert.ok((await adapter.handle('distribution:cancel', envelope({ previewRequestId: first.requestId }), trusted, trace)).ok);
});

test('distribution DTOs retain relative file names but reject path escapes, controls and mixed conflicts', () => {
  const value = summary(query()); assert.ok(isDistributionSummary(value));
  for (const path of ['../escape', '/absolute', 'C:/private', 'folder\\file', 'file\nname', 'file\u0000name']) {
    assert.equal(isDistributionSummary({ ...value, ownership: [{ ...value.ownership[0], path }] }), false, JSON.stringify(path));
  }
  assert.equal(isDistributionSummary({ ...value, conflicts: [{ area: 'mods', path: 'a.jar', code: 'CHANGED' }], changes: [{ area: 'mods', path: 'b.jar', kind: 'add' }] }), false);
  assert.equal(isDistributionSummary({ ...value, totalFiles: 201 }), false);
});

test('distribution public enums require strings rather than coercible arrays', () => {
  const value = summary(query());
  assert.equal(isDistributionSummary({ ...value, receiptStatus: ['valid'] }), false);
  assert.equal(isDistributionSummary({ ...value, ownership: [{ ...value.ownership[0], area: ['mods'] }] }), false);
  assert.equal(isDistributionSummary({ ...value, ownership: [{ ...value.ownership[0], ownership: ['user-added'] }] }), false);
  assert.equal(isDistributionSummary({ ...value, changes: [{ area: 'mods', path: 'a.jar', kind: ['add'] }] }), false);
  assert.equal(isDistributionSummary({ ...value, conflicts: [{ area: 'mods', path: 'a.jar', code: ['CHANGED'] }] }), false);
});

test('distribution source-list port exceptions become controlled public failures', async () => {
  const adapter = new DistributionPreviewAdapter({ listSources: () => { throw new Error('D:/private/token-secret'); }, preview: async input => summary(input) });
  const result = await adapter.handle('distribution:sources', envelope({}), trusted, trace);
  failure(result, 'UNAVAILABLE'); assert.equal(JSON.stringify(result).includes('token-secret'), false);
});

test('both adapters redact unexpected port failures instead of exposing private exceptions', async () => {
  const fixture = toolsFixture(); fixture.service.open = async () => { throw new Error('D:/private/token-secret'); };
  const tools = await fixture.adapter.handle('tools:open', envelope({ toolId: 'test-tool' }), trusted, trace);
  const adapter = new DistributionPreviewAdapter({ listSources: () => [], preview: async () => { throw new Error('https://private.invalid/token-secret'); } });
  const distribution = await adapter.handle('distribution:preview', envelope(query()), trusted, trace);
  failure(tools, 'UNAVAILABLE'); failure(distribution, 'UNAVAILABLE');
  assert.equal(JSON.stringify([tools, distribution]).includes('token-secret'), false);
});

test('preload bridges reject invalid input before IPC and reject forged operation results', async () => {
  let calls = 0; const invoke = async (_channel: string, input: unknown): Promise<unknown> => {
    calls++; const id = (input as { requestId: string }).requestId;
    return { contractVersion: 1, requestId: id, ok: true, data: { cancelled: true } };
  };
  const tools = createOnlineToolsBridge({ invoke }); const distribution = createDistributionBridge({ invoke });
  failure(await tools.openOnlineTool('invalid', 'test-tool'), 'INVALID_ARGUMENT');
  failure(await tools.openOnlineTool(randomUUID(), 'https://untrusted.invalid'), 'INVALID_ARGUMENT');
  failure(await distribution.previewDistribution(randomUUID(), { ...query(), sourceId: '../escape' }), 'INVALID_ARGUMENT');
  failure(await distribution.cancelDistributionPreview('invalid'), 'INVALID_ARGUMENT'); assert.equal(calls, 0);
  failure(await tools.onlineToolState(), 'UNAVAILABLE');
  failure(await distribution.previewDistribution(randomUUID(), query()), 'UNAVAILABLE'); assert.equal(calls, 2);
});

test('preload bridges validate response version and request identity with real adapters', async () => {
  const fixture = toolsFixture();
  const tools = createOnlineToolsBridge({ invoke: async (channel, input) => fixture.adapter.handle(channel as 'tools:state', input, trusted, trace) });
  const result = await tools.openOnlineTool(randomUUID(), 'test-tool'); assert.ok(result.ok); assert.ok(isOnlineToolsResult(result, result.requestId));
  const distributionAdapter = new DistributionPreviewAdapter({ listSources: () => [], preview: async input => summary(input) });
  const distribution = createDistributionBridge({ invoke: async (channel, input) => distributionAdapter.handle(channel as 'distribution:preview', input, trusted, trace) });
  assert.ok((await distribution.previewDistribution(randomUUID(), query())).ok);
  const forged = createOnlineToolsBridge({ invoke: async () => ({ ...result, contractVersion: 2 }) });
  failure(await forged.onlineToolState(), 'UNAVAILABLE');
});

test('online preload timeout preserves the mutation identity and never implicitly retries', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred<unknown>(); let calls = 0; const id = randomUUID();
  const bridge = createOnlineToolsBridge({ invoke: async (_channel, input) => { calls++; assert.equal((input as { requestId: string }).requestId, id); return gate.promise; } });
  const pending = bridge.openOnlineTool(id, 'test-tool'); context.mock.timers.tick(15000);
  const result = await pending; failure(result, 'TIMEOUT'); assert.equal(result.requestId, id);
  gate.resolve({ contractVersion: 1, requestId: id, ok: true, data: { tools: [], snapshot: { revision: 1, phase: 'ready', toolId: 'test-tool' } } });
  await Promise.resolve(); assert.equal(calls, 1); failure(result, 'TIMEOUT');
});

test('distribution preload timeout never cancels or retries a preview and ignores its late reply', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred<unknown>(); const channels: string[] = []; const id = randomUUID(); const input = query();
  const bridge = createDistributionBridge({ invoke: async channel => { channels.push(channel); return gate.promise; } });
  const pending = bridge.previewDistribution(id, input); context.mock.timers.tick(45000);
  const result = await pending; failure(result, 'TIMEOUT'); assert.equal(result.requestId, id);
  gate.resolve({ contractVersion: 1, requestId: id, ok: true, data: { preview: summary(input) } });
  await Promise.resolve(); assert.deepEqual(channels, ['distribution:preview']); failure(result, 'TIMEOUT');
});
