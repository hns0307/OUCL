import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DISTRIBUTION_EXECUTION_CAPABILITY, DISTRIBUTION_EXECUTION_CHANNELS, DISTRIBUTION_EXECUTION_CODES,
  DISTRIBUTION_EXECUTION_IPC_TIMEOUT_MS, DISTRIBUTION_EXECUTION_PREPARE_TIMEOUT_MS, DISTRIBUTION_EXECUTION_PROPOSAL_TTL_MS,
  DISTRIBUTION_EXECUTION_MAX_ACTIVE, DISTRIBUTION_EXECUTION_MAX_SEEN, DISTRIBUTION_EXECUTION_MAX_RESPONSE_BYTES,
  distributionExecutionFailure, isDistributionExecutionBinding, isDistributionExecutionData, isDistributionExecutionError,
  isDistributionExecutionPayload, isDistributionExecutionPreparation, isDistributionExecutionProposal,
  isDistributionExecutionRequest, isDistributionExecutionResult } from '../src/shared/contracts/distribution-execution.js';
import type { DistributionExecutionChannel, DistributionExecutionData, DistributionExecutionPayloads, DistributionExecutionProposal,
  DistributionExecutionRequest } from '../src/shared/contracts/distribution-execution.js';
import type { TaskSnapshot } from '../src/shared/contracts/instances.js';

const ids = Array.from({ length: 10 }, () => randomUUID());
const binding = { rootId: ids[0]!, instanceId: ids[1]!, sourceId: 'fixture-source', packageId: 'fixture-pack', packageVersion: '1.0' };
const prepareId = ids[2]!; const proposalId = ids[3]!; const taskId = ids[4]!;
function proposal(): DistributionExecutionProposal {
  return { ...binding, proposalId, sequence: 1, instanceRevision: 2, expiresAt: 1795000000000,
    changes: [{ area: 'mods', path: 'fixture.jar', kind: 'add' }], conflicts: [] };
}
const snapshot: TaskSnapshot = { taskId, kind: 'distribution-install', state: 'queued', stage: 'queued', revision: 1, bytesDone: 0 };

test('distribution execution receipts reject other existing task kinds', () => {
  for (const kind of ['install', 'launch', 'mod-install'] as const) {
    const other = { ...snapshot, kind };
    assert.equal(isDistributionExecutionData({ taskId, proposalId, snapshot: other }, 'distribution:confirmExecution'), false);
    assert.equal(isDistributionExecutionData({ taskId, recoveryRequestId: ids[5]!, snapshot: other }, 'distribution:recoverExecution'), false);
  }
});
const payloads: DistributionExecutionPayloads = {
  'distribution:prepareExecution': binding, 'distribution:executionPreparation': { prepareRequestId: prepareId },
  'distribution:cancelExecutionPreparation': { prepareRequestId: prepareId },
  'distribution:confirmExecution': { proposalId, instanceRevision: 2, sequence: 1 }, 'distribution:recoverExecution': { taskId },
};
function request<C extends DistributionExecutionChannel>(channel: C): DistributionExecutionRequest<C> {
  return { contractVersion: 1, requestId: channel === 'distribution:prepareExecution' ? prepareId : ids[5]!, payload: structuredClone(payloads[channel]) };
}
function data(): DistributionExecutionData {
  return { 'distribution:prepareExecution': { prepareRequestId: prepareId, state: 'ready', proposal: proposal(), error: null },
    'distribution:executionPreparation': { prepareRequestId: prepareId, state: 'ready', proposal: proposal(), error: null },
    'distribution:cancelExecutionPreparation': { cancelled: true },
    'distribution:confirmExecution': { taskId, proposalId, snapshot: structuredClone(snapshot) },
    'distribution:recoverExecution': { taskId, recoveryRequestId: ids[5]!, snapshot: structuredClone(snapshot) } };
}
function result<C extends DistributionExecutionChannel>(channel: C) {
  return { contractVersion: 1, requestId: request(channel).requestId, ok: true, data: data()[channel] };
}

test('execution contract defines five channels and the approved bounded lifecycle constants', () => {
  assert.equal(DISTRIBUTION_EXECUTION_CAPABILITY, 'distribution.execute.v1'); assert.equal(DISTRIBUTION_EXECUTION_CHANNELS.length, 5);
  assert.deepEqual([DISTRIBUTION_EXECUTION_IPC_TIMEOUT_MS, DISTRIBUTION_EXECUTION_PREPARE_TIMEOUT_MS, DISTRIBUTION_EXECUTION_PROPOSAL_TTL_MS,
    DISTRIBUTION_EXECUTION_MAX_ACTIVE, DISTRIBUTION_EXECUTION_MAX_SEEN], [3000, 120000, 300000, 16, 1024]);
  for (const channel of DISTRIBUTION_EXECUTION_CHANNELS) {
    assert.equal(isDistributionExecutionPayload(payloads[channel], channel), true);
    assert.equal(isDistributionExecutionRequest(request(channel), channel), true);
    assert.equal(isDistributionExecutionData(data()[channel], channel), true);
    assert.equal(isDistributionExecutionResult(result(channel), request(channel), channel), true);
  }
});

test('requests reject future versions, unknown fields, noncanonical UUIDs and arbitrary path or URL input', () => {
  for (const channel of DISTRIBUTION_EXECUTION_CHANNELS) {
    const valid = request(channel);
    for (const value of [{ ...valid, contractVersion: 2 }, { ...valid, extra: true }, { ...valid, requestId: valid.requestId.toUpperCase() },
      { ...valid, payload: { ...valid.payload, url: 'https://untrusted.invalid' } }]) assert.equal(isDistributionExecutionRequest(value, channel), false);
  }
  for (const value of [{ ...binding, rootId: binding.rootId.toUpperCase() }, { ...binding, sourceId: '../source' }, { ...binding, key: 'untrusted' }]) {
    assert.equal(isDistributionExecutionBinding(value), false);
  }
  assert.equal(isDistributionExecutionPayload({ proposalId, instanceRevision: 0, sequence: 1 }, 'distribution:confirmExecution'), false);
  assert.equal(isDistributionExecutionPayload({ proposalId, instanceRevision: 1, sequence: Number.MAX_SAFE_INTEGER + 1 }, 'distribution:confirmExecution'), false);
});

test('proposal enforces 256 operations, exact 1024 path boundary, safe Windows paths and nonoverlap', () => {
  const maximumPath = ['a'.repeat(255), 'b'.repeat(255), 'c'.repeat(255), 'd'.repeat(250), 'x.jar'].join('/'); assert.equal(maximumPath.length, 1024);
  assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: [{ area: 'mods', path: maximumPath, kind: 'add' }] }), true);
  assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: [{ area: 'mods', path: maximumPath + 'x', kind: 'add' }] }), false);
  const operations = Array.from({ length: 256 }, (_, index) => ({ area: 'mods', path: `${index}.jar`, kind: 'add' }));
  assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: operations }), true);
  assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: [...operations, { area: 'mods', path: 'extra.jar', kind: 'add' }] }), false);
  for (const path of ['../escape', 'a/../../escape', '/absolute', 'C:/absolute', 'a\\b', 'CON.jar', 'trailing.', 'trailing ', 'a//b', 'mod.jar:stream', 'a\u0000b']) {
    assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: [{ area: 'mods', path, kind: 'add' }] }), false, path);
  }
  for (const changes of [[{ area: 'mods', path: 'A.jar', kind: 'add' }, { area: 'mods', path: 'a.jar', kind: 'add' }],
    [{ area: 'mods', path: 'parent', kind: 'add' }, { area: 'mods', path: 'parent/child.jar', kind: 'add' }], [{ area: 'config', path: 'settings.json', kind: 'remove' }]]) {
    assert.equal(isDistributionExecutionProposal({ ...proposal(), changes }), false);
  }
  assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: [], conflicts: [{ area: 'mods', path: 'existing.jar', code: 'EXISTS' }] }), true);
  assert.equal(isDistributionExecutionProposal({ ...proposal(), conflicts: [{ area: 'mods', path: 'existing.jar', code: 'EXISTS' }] }), false);
  assert.equal(isDistributionExecutionProposal({ ...proposal(), journal: {} }), false);
  assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: [{ area: 'mods', path: 'fixture.jar', kind: ['add'] }] }), false);
  assert.equal(isDistributionExecutionProposal({ ...proposal(), changes: [], conflicts: [{ area: 'mods', path: 'fixture.jar', code: ['EXISTS'] }] }), false);
});

test('preparation states constrain proposal/error to one exact discriminated variant', () => {
  const failure = distributionExecutionFailure(prepareId, 'SOURCE_UNAVAILABLE', ids[6]!); assert.equal(failure.ok, false); if (failure.ok) return;
  for (const state of ['pending', 'cancelled', 'expired']) assert.equal(isDistributionExecutionPreparation({ prepareRequestId: prepareId, state, proposal: null, error: null }), true);
  assert.equal(isDistributionExecutionPreparation({ prepareRequestId: prepareId, state: 'failed', proposal: null, error: failure.error }), true);
  for (const value of [{ prepareRequestId: prepareId, state: 'ready', proposal: null, error: null },
    { prepareRequestId: prepareId, state: 'pending', proposal: proposal(), error: null },
    { prepareRequestId: prepareId, state: 'failed', proposal: null, error: null },
    { prepareRequestId: prepareId, state: 'ready', proposal: proposal(), error: failure.error },
    { prepareRequestId: prepareId, state: 'future', proposal: null, error: null },
    { prepareRequestId: prepareId, state: ['pending'], proposal: null, error: null }]) assert.equal(isDistributionExecutionPreparation(value), false);
});

test('accepted/recovery validate real TaskSnapshot structure and cannot substitute task identity or unintroduced kind', () => {
  const valid = data()['distribution:confirmExecution'];
  for (const value of [{ ...valid, taskId: ids[7] }, { ...valid, snapshot: { ...snapshot, kind: 'distribution-future' } },
    { ...valid, snapshot: { ...snapshot, revision: 0 } }, { ...valid, snapshot: { ...snapshot, bytesDone: -1 } },
    { ...valid, snapshot: { ...snapshot, rawPath: 'private' } }]) assert.equal(isDistributionExecutionData(value, 'distribution:confirmExecution'), false);
  assert.equal(isDistributionExecutionResult({ ...result('distribution:recoverExecution'), data: { ...data()['distribution:recoverExecution'], recoveryRequestId: ids[8] } }, request('distribution:recoverExecution'), 'distribution:recoverExecution'), false);
});

test('result correlation rejects wrong prepare identities, cross-instance proposals, wrong proposal and mixed channel DTOs', () => {
  const ready = data()['distribution:prepareExecution']; assert.equal(ready.state, 'ready'); if (ready.state !== 'ready') return;
  for (const changed of [{ ...ready, prepareRequestId: ids[7] }, { ...ready, proposal: { ...ready.proposal, instanceId: ids[7] } },
    { ...ready, proposal: { ...ready.proposal, sourceId: 'other' } }]) {
    assert.equal(isDistributionExecutionResult({ ...result('distribution:prepareExecution'), data: changed }, request('distribution:prepareExecution'), 'distribution:prepareExecution'), false);
  }
  assert.equal(isDistributionExecutionResult({ ...result('distribution:confirmExecution'), data: { ...data()['distribution:confirmExecution'], proposalId: ids[7] } }, request('distribution:confirmExecution'), 'distribution:confirmExecution'), false);
  for (const channel of DISTRIBUTION_EXECUTION_CHANNELS) {
    for (const value of [{ ...result(channel), contractVersion: 2 }, { ...result(channel), requestId: ids[9] }, { ...result(channel), extra: true },
      { ...result(channel), data: { secret: 'unexpected' } }]) assert.equal(isDistributionExecutionResult(value, request(channel), channel), false);
  }
});

test('all error codes roundtrip their exact mapping; unknown codes, details, retry drift and oversized responses fail', () => {
  for (const code of DISTRIBUTION_EXECUTION_CODES) {
    const failure = distributionExecutionFailure(prepareId, code, ids[6]!); assert.equal(failure.ok, false); if (failure.ok) continue;
    assert.equal(isDistributionExecutionError(failure.error), true);
    assert.equal(isDistributionExecutionResult(failure, request('distribution:prepareExecution'), 'distribution:prepareExecution'), true);
    for (const error of [{ ...failure.error, code: 'FUTURE_ERROR' }, { ...failure.error, detail: 'raw stack' },
      { ...failure.error, retryable: !failure.error.retryable }, { ...failure.error, traceId: ids[6]!.toUpperCase() }]) assert.equal(isDistributionExecutionError(error), false);
  }
  const oversized = { ...result('distribution:prepareExecution'), data: { unexpected: 'x'.repeat(DISTRIBUTION_EXECUTION_MAX_RESPONSE_BYTES + 1) } };
  assert.equal(isDistributionExecutionResult(oversized, request('distribution:prepareExecution'), 'distribution:prepareExecution'), false);
  const cycle: { self?: object } = {}; cycle.self = cycle;
  assert.equal(isDistributionExecutionData(cycle, 'distribution:prepareExecution'), false);
});
