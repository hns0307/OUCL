import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMods, modDispatcher } from '../src/ipc/mods.js';
import { ModContractError, isModResult } from '../src/shared/contracts/mods.js';
import type { ModChannel, ModCode, ModData, ModDispatcher } from '../src/shared/contracts/mods.js';

const id = '00000000-0000-4000-8000-000000000001';
const trace = '00000000-0000-4000-8000-000000000002';
const input = { contractVersion: 1, requestId: id, payload: { instanceId: id, expectedRevision: 1 } };
test('Mod IPC rejects untrusted envelopes before touching a service', async () => {
  let calls = 0;
  const dispatch: ModDispatcher = async () => { calls++; throw new Error('private path'); };
  for (const [request, trusted, code] of [[input, false, 'INVALID_SENDER'], [{ ...input, contractVersion: 2 }, true, 'UNSUPPORTED_CONTRACT'],
    [{ ...input, path: 'private' }, true, 'INVALID_ARGUMENT'], [{ ...input, payload: { ...input.payload, path: 'private' } }, true, 'INVALID_ARGUMENT'],
    [{ ...input, requestId: '../path' }, true, 'INVALID_ARGUMENT']] as const) {
    const result = await handleMods('mods:check', request, trusted, trace, dispatch);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, code);
    assert.ok(isModResult(result, Object.keys(request).length === 3 && request.requestId === id ? id : trace, 'mods:check'));
  }
  assert.equal(calls, 0);
});
test('Mod IPC preserves idempotency identities and report/task channel shapes', async () => {
  const calls: unknown[] = [];
  const plan = { formatVersion: 1 as const, planId: 'a'.repeat(64), instanceId: id, instanceRevision: 1, fingerprint: 'b'.repeat(64),
    minecraft: '1.20.1', loader: 'fabric' as const, rootVersionId: 'RootVer1', state: 'ready' as const, attempts: 2, totalDownloadBytes: 7,
    items: [{ projectId: 'Depends1', versionId: 'DepVers1', filename: 'dependency.jar', fileId: 'c'.repeat(40), sha512: 'd'.repeat(128),
      size: 7, disposition: 'download' as const, requiredBy: ['RootProj'] }], issues: [] };
  const dispatch = modDispatcher({ start: async (...args) => { calls.push(args); return { taskId: trace }; },
    report: async taskId => { calls.push(taskId); return { report: null, errorCode: 'CANCELLED' }; } },
  { plan: async value => { calls.push(value); return plan; } });
  for (const mode of ['list', 'check'] as const) {
    const result = await handleMods(`mods:${mode}`, input, true, trace, dispatch);
    assert.deepEqual(result, { contractVersion: 1, requestId: id, ok: true, data: { taskId: trace } });
    assert.deepEqual(calls.at(-1), [id, mode, input.payload]);
  }
  const report = await handleMods('mods:report', { ...input, payload: { taskId: trace } }, true, trace, dispatch);
  assert.ok(isModResult(report, id, 'mods:report')); assert.equal(calls.at(-1), trace);
  assert.equal(report.ok && report.data.errorCode, 'CANCELLED');
  const planPayload = { instanceId: id, expectedRevision: 1, root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: 'c'.repeat(40) }, selections: {} };
  const planned = await handleMods('mods:plan', { ...input, payload: planPayload }, true, trace, dispatch);
  assert.ok(isModResult(planned, id, 'mods:plan')); assert.deepEqual(planned.ok && planned.data.plan, plan); assert.deepEqual(calls.at(-1), planPayload);
});

test('Mod plan contract rejects paths, arbitrary selections and malformed plan evidence', async () => {
  const payload = { instanceId: id, expectedRevision: 1, root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: 'c'.repeat(40) }, selections: {} };
  for (const bad of [{ ...payload, path: 'C:\\private' }, { ...payload, selections: { '../bad': 'DepVers1' } },
    { ...payload, root: { ...payload.root, url: 'https://example.invalid/file.jar' } }]) {
    const result = await handleMods('mods:plan', { ...input, payload: bad }, true, trace, async () => { throw new Error('called'); });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'INVALID_ARGUMENT');
  }
  const result = await handleMods('mods:plan', { ...input, payload }, true, trace, async () => ({ plan: { path: 'private' } } as never));
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'UNAVAILABLE');
});
test('Mod IPC rejects malformed service output and redacts unexpected failures', async () => {
  for (const value of [{ taskId: id, path: 'private' }, { taskId: '../private' }, { report: null, errorCode: null }]) {
    const dispatch = (async () => value) as unknown as ModDispatcher;
    const result = await handleMods('mods:check', input, true, trace, dispatch);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'UNAVAILABLE');
  }
  for (const code of ['SCAN_BUSY', 'REVISION_CONFLICT', 'NEEDS_RECOVERY'] as ModCode[]) {
    const result = await handleMods('mods:check', input, true, trace, async () => { throw new ModContractError(code); });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, code);
  }
  const failed = await handleMods('mods:check', input, true, trace, async () => { throw new Error('private/path'); });
  assert.ok(!JSON.stringify(failed).includes('private'));
  await assert.rejects(modDispatcher({ start: async () => ({ taskId: id }), report: async () => ({ report: null, errorCode: null }) })(
    'mods:unknown' as ModChannel, input.payload, id), ModContractError);
  const bad = { start: async () => ({ taskId: 'bad' }), report: async (): Promise<ModData['mods:report']> => ({ report: null, errorCode: null }) };
  await assert.rejects(modDispatcher(bad)('mods:list', input.payload, id), ModContractError);
});
