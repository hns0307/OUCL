import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isTargetRequest, isTargetResult, targetFilter } from './contract-candidate.js';
import type { TargetRequest, TargetResult } from './contract-candidate.js';
import { projectCandidate } from './binding-candidate.js';
import type { BindingInput } from './binding-candidate.js';
import { createExecution } from '../../../../../src/core/task/machine.js';
import { instanceFailure } from '../../../../../src/shared/contracts/instances.js';
import { modConfirmationDigest, modPlanDigest, modPlanInputDigest } from '../../../../../src/services/mods/plan-identity.js';
import type { ModInstallPlan, ModPayloads } from '../../../../../src/shared/contracts/mods.js';
import type { StoredModPlan } from '../../../../../src/services/storage/mod-plans.js';
import type { ModJobs } from '../../../../../src/services/storage/mod-jobs.js';
const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const root = id(1), a = id(2), b = id(3);
function plan(instanceId: string, requestId: string): StoredModPlan {
  const input: ModPayloads['mods:plan'] = { instanceId, expectedRevision: 4, root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: 'a'.repeat(40) }, selections: {} };
  const body: Omit<ModInstallPlan, 'planId'> = { formatVersion: 1, instanceId, instanceRevision: 4, fingerprint: 'b'.repeat(64), minecraft: '1.20.1', loader: 'fabric',
    rootVersionId: 'RootVer1', state: 'ready', attempts: 1, totalDownloadBytes: 0,
    items: [{ projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', fileId: 'a'.repeat(40), sha512: 'c'.repeat(128), size: 1, disposition: 'library', requiredBy: [] }], issues: [] };
  return { formatVersion: 1, rootId: root, requestId, payloadDigest: modPlanInputDigest(input), input, plan: { ...body, planId: modPlanDigest(body) }, status: 'preview' };
}
function fixture(): BindingInput {
  const input: BindingInput = { rootId: root, instanceId: a, kinds: ['mod-check', 'mod-install'], admissions: [], jobs: { formatVersion: 1, rootId: root, items: [] }, plans: {}, snapshots: {} };
  const jobs = input.jobs as ModJobs;
  for (const [index, instanceId] of [a, b].entries()) {
    const requestId = id(100 + index), taskId = id(200 + index);
    const digest = createHash('sha256').update(JSON.stringify({ instanceId, expectedRevision: 4, mode: 'check' })).digest('hex');
    jobs.items.push({ taskId, requestId, payloadDigest: digest, instanceId, instanceRevision: 4, mode: 'check', stage: 'queued', reportRevision: 0, errorCode: null });
    input.admissions.push({ requestId, payloadDigest: digest, task: { taskId, ownerId: root, kind: 'mod-check', execution: createExecution() } });
    input.snapshots[taskId] = { taskId, kind: 'mod-check', state: 'running', stage: 'preparing', revision: 2, bytesDone: 0 };
    const confirmationId = id(300 + index), installationId = id(400 + index), stored = plan(instanceId, confirmationId);
    input.plans[confirmationId] = stored;
    input.admissions.push({ requestId: confirmationId, payloadDigest: modConfirmationDigest(confirmationId, stored.plan.planId),
      task: { taskId: installationId, ownerId: root, kind: 'mod-install', execution: createExecution() } });
    input.snapshots[installationId] = { taskId: installationId, kind: 'mod-install', state: 'running', stage: 'preparing', revision: 2, bytesDone: 0 };
  }
  return input;
}
const request = (): TargetRequest => ({ contractVersion: 1, requestId: id(9), payload: { instanceId: a, kinds: ['mod-check', 'mod-install'], limit: 100 } });
const response = (): TargetResult => ({ contractVersion: 1, requestId: id(9), ok: true, data: { items: projectCandidate(fixture()) } });

test('candidate exact request accepts only the two frozen Mod kinds and bounded query', () => {
  assert.equal(isTargetRequest(request()), true);
  for (const patch of [{ rootId: root }, { path: 'ignored' }, { limit: 101 }, { limit: 0 }, { kinds: [] }, { kinds: ['mod-check', 'mod-check'] }, { kinds: ['download'] }, { cursor: '' }]) {
    assert.equal(isTargetRequest({ ...request(), payload: { ...request().payload, ...patch } }), false);
  }
  assert.equal(isTargetRequest({ ...request(), contractVersion: 2 }), false);
  assert.equal(isTargetRequest({ ...request(), extra: true }), false);
});
test('candidate response is correlated, selected-target-only and path-free', () => {
  const valid = response(); assert.equal(isTargetResult(valid, request()), true); if (!valid.ok) throw new Error('fixture');
  assert.equal(isTargetResult({ ...valid, requestId: id(10) }, request()), false);
  assert.equal(isTargetResult({ ...valid, data: { ...valid.data, rootId: root } }, request()), false);
  for (const patch of [{ instanceId: b }, { instanceRevision: 0 }, { localPath: 'ignored' }]) {
    assert.equal(isTargetResult({ ...valid, data: { items: [{ ...valid.data.items[0], ...patch }] } }, request()), false);
  }
  assert.equal(isTargetResult({ ...valid, data: { items: [valid.data.items[0], valid.data.items[0]] } }, request()), false);
});
test('kind filter, per-page size and no-progress cursor are enforced', () => {
  const valid = response(); if (!valid.ok) throw new Error('fixture');
  assert.equal(isTargetResult(valid, { ...request(), payload: { ...request().payload, kinds: ['mod-check'] } }), false);
  assert.equal(isTargetResult(valid, { ...request(), payload: { ...request().payload, limit: 1 } }), false);
  assert.equal(isTargetResult({ ...valid, data: { items: [], nextCursor: id(77) } }, request()), false);
});
test('only the frozen error mappings cross the proposed endpoint', () => {
  assert.equal(isTargetResult(instanceFailure(id(9), 'NEEDS_RECOVERY', id(8)), request()), true);
  assert.equal(isTargetResult(instanceFailure(id(9), 'INSTALL_FAILED', id(8)), request()), false);
  const result = instanceFailure(id(9), 'NEEDS_RECOVERY', id(8)); if (result.ok) throw new Error('fixture');
  assert.equal(isTargetResult({ ...result, error: { ...result.error, messageKey: 'timeout' } }, request()), false);
});
test('cursor filter canonicalizes UUID casing and kind order without changing the target set', () => {
  const query = request().payload;
  assert.equal(targetFilter(query), targetFilter({ ...query, instanceId: query.instanceId.toUpperCase(), kinds: [...query.kinds].reverse() }));
  assert.notEqual(targetFilter(query), targetFilter({ ...query, instanceId: b }));
});
test('A and B have separate, persistently provable check and install targets', () => {
  const input = fixture(); const first = projectCandidate(input); const second = projectCandidate({ ...input, instanceId: b });
  assert.deepEqual(first.map(row => row.task.taskId), [id(200), id(400)]);
  assert.deepEqual(second.map(row => row.task.taskId), [id(201), id(401)]);
  assert.ok(first.every(row => row.instanceId === a && row.instanceRevision === 4));
});
for (const state of ['failed', 'cancelled', 'needsRecovery'] as const) test(`target identity remains valid for ${state} instead of silently re-running work`, () => {
  const input = fixture(); input.snapshots[id(200)] = { ...input.snapshots[id(200)]!, state, stage: state, revision: 3 };
  const result = projectCandidate(input); assert.equal(result[0]?.task.state, state); assert.equal(result[0]?.instanceRevision, 4);
});
const corruptions: [string, (input: BindingInput) => void][] = [
  ['cross-root task', value => { value.admissions[0]!.task.ownerId = id(99); }],
  ['wrong check digest', value => { value.admissions[0]!.payloadDigest = 'f'.repeat(64); }],
  ['missing job index', value => { value.jobs = undefined; }],
  ['orphan admitted task', value => { (value.jobs as ModJobs).items.shift(); }],
  ['orphan job record', value => { value.admissions.shift(); }],
  ['missing plan even for another instance', value => { delete value.plans[id(301)]; }],
  ['wrong confirmation digest', value => { value.admissions[1]!.payloadDigest = 'f'.repeat(64); }],
  ['wrong plan root', value => { (value.plans[id(300)] as StoredModPlan).rootId = id(99); }],
  ['cancelled accepted plan', value => { (value.plans[id(300)] as StoredModPlan).status = 'cancelled'; }],
  ['future job format', value => { value.jobs = { ...(value.jobs as ModJobs), formatVersion: 2 }; }],
  ['duplicate task identity', value => { value.admissions.push(structuredClone(value.admissions[0]!)); }],
  ['cross-kind public snapshot', value => { value.snapshots[id(200)]!.kind = 'download'; }],
  ['stale public snapshot', value => { value.admissions[0]!.task.execution.revision = 4; }],
];
for (const [name, corrupt] of corruptions) test(`unproven binding stops the selected domain: ${name}`, () => {
  const input = fixture(); corrupt(input); assert.throws(() => projectCandidate(input), { code: 'NEEDS_RECOVERY' });
});
test('selected kinds do not require unrequested domain records', () => {
  const input = fixture(); input.kinds = ['mod-check']; input.plans = {};
  assert.deepEqual(projectCandidate(input).map(row => row.task.kind), ['mod-check']);
});
test('JSON inputs replay in two fresh processes with no memory taskId ownership map', async () => {
  const base = path.resolve('docs/work-packages/P-B/validation/T1-20261110/cases'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'replay-')); const file = path.join(directory, 'input.json'); const input = fixture();
  await writeFile(file, JSON.stringify(input)); const expected = JSON.stringify(projectCandidate(input));
  for (let n = 0; n < 2; n++) {
    const child = spawnSync(process.execPath, [path.resolve('docs/work-packages/P-B/validation/T1-20261110/build/replay-probe.mjs'), file], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, expected);
  }
});

test('unrequested check-index format is not inspected by an install-only read', () => {
  const input = fixture(); input.kinds = ['mod-install']; input.jobs = { formatVersion: 999 };
  assert.deepEqual(projectCandidate(input).map(row => row.task.kind), ['mod-install']);
});
