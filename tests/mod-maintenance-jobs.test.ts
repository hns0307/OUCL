import assert from 'node:assert/strict';
import test from 'node:test';
import { MaintenancePreviewJobs } from '../src/services/mods/maintenance-jobs.js';
import type { MaintenancePreview } from '../src/services/mods/maintenance-preview.js';
import { handleMaintenancePreview } from '../src/ipc/maintenance-preview.js';
import { isMaintenanceDisplay, isPreviewData, isPreviewResult } from '../src/shared/contracts/mod-maintenance-preview.js';
import type { PreviewInput } from '../src/shared/contracts/mod-maintenance-preview.js';

const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';
const input: PreviewInput = { rootId, instanceId, expectedRevision: 1, expectedFingerprint: 'a'.repeat(64), fileId: 'b'.repeat(64), action: 'disable' };
function observation(): MaintenancePreview {
  const local = { state: 'satisfied' as const, issues: [], providers: [] };
  const platform = { state: 'satisfied' as const, issues: [], files: [] };
  return { rootId, instanceId, instanceRevision: 1, fingerprint: input.expectedFingerprint, filename: 'some.jar', sha256: 'c'.repeat(64), platformFailures: [],
    impact: { fileId: input.fileId, action: 'disable', state: 'ready', before: { local, platform }, after: { local, platform },
      introducedIssues: [], resolvedIssues: [], affectedProviders: [], directRequiredBy: [], transitiveRequiredBy: [], relations: [], truncated: false } };
}
async function settled(): Promise<void> { await new Promise(resolve => setImmediate(resolve)); }
test('admission is idempotent across key ordering and completed results are independently copied', async () => {
  let calls = 0; const jobs = new MaintenancePreviewJobs({ preview: async () => { calls++; return observation(); } });
  const first = jobs.start(requestId, input); const reordered = { action: input.action, fileId: input.fileId, expectedFingerprint: input.expectedFingerprint,
    expectedRevision: input.expectedRevision, instanceId, rootId };
  assert.deepEqual(jobs.start(requestId, reordered), first);
  assert.throws(() => jobs.start(requestId, { ...input, action: 'enable' }), { code: 'INVALID_ARGUMENT' });
  await settled(); assert.equal(calls, 1); const status = jobs.get(first.previewId); assert.equal(status.status, 'completed');
  assert.ok(isMaintenanceDisplay(status.result)); status.result!.filename = 'changed.jar';
  assert.equal(jobs.get(first.previewId).result!.filename, 'some.jar'); await jobs.close();
});
test('running cancellation joins scanner exit, queued cancellation never starts and capacity is bounded', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const jobs = new MaintenancePreviewJobs({ preview: async () => { calls++; await gate; return observation(); } });
  const running = jobs.start(requestId, input); await settled();
  const queued = jobs.start('00000000-0000-4000-8000-000000000004', input);
  assert.equal((await jobs.cancel(queued.previewId)).status, 'cancelled'); assert.equal(calls, 1);
  for (let i = 5; i <= 18; i++) jobs.start(`00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`, input);
  assert.throws(() => jobs.start('00000000-0000-4000-8000-000000000019', input), { code: 'SCAN_BUSY' });
  let cancelled = false; const pending = jobs.cancel(running.previewId).then(value => { cancelled = true; return value; });
  await settled(); assert.equal(cancelled, false); release(); assert.equal((await pending).status, 'cancelled');
  await jobs.close();
});
test('expiry is monotonic and late acceptance retry cannot start a second scan', async () => {
  let clock = 0; let calls = 0; const jobs = new MaintenancePreviewJobs({ preview: async () => { calls++; return observation(); } }, () => clock);
  const first = jobs.start(requestId, input); await settled(); clock = 899999; assert.equal(jobs.get(first.previewId).status, 'completed');
  clock++; assert.throws(() => jobs.get(first.previewId), { code: 'PREVIEW_EXPIRED' });
  assert.throws(() => jobs.start(requestId, input), { code: 'PREVIEW_EXPIRED' }); assert.equal(calls, 1); await jobs.close();
});
test('a restarted registry never silently restores old ephemeral observations', async () => {
  const first = new MaintenancePreviewJobs({ preview: async () => observation() });
  const accepted = first.start(requestId, input); await settled(); await first.close();
  const restarted = new MaintenancePreviewJobs({ preview: async () => observation() });
  assert.throws(() => restarted.get(accepted.previewId), { code: 'PREVIEW_EXPIRED' });
  const next = restarted.start('00000000-0000-4000-8000-000000000004', input);
  assert.notEqual(next.previewId, accepted.previewId); await restarted.close();
});
test('sender and exact input validation run before service access, and status is correlated', async () => {
  let calls = 0; const jobs = new MaintenancePreviewJobs({ preview: async () => { calls++; return observation(); } });
  const envelope = { contractVersion: 1, requestId, payload: input };
  const denied = await handleMaintenancePreview('mods:maintenancePreview', envelope, false, rootId, jobs);
  assert.ok(!denied.ok); assert.equal(denied.error.code, 'INVALID_SENDER');
  const extra = await handleMaintenancePreview('mods:maintenancePreview', { ...envelope, payload: { ...input, path: 'C:/private' } }, true, rootId, jobs);
  assert.ok(!extra.ok); assert.equal(extra.error.code, 'INVALID_ARGUMENT'); assert.equal(calls, 0);
  const accepted = await handleMaintenancePreview('mods:maintenancePreview', envelope, true, rootId, jobs);
  assert.ok(accepted.ok); await settled();
  const status = await handleMaintenancePreview('mods:maintenancePreviewStatus', { contractVersion: 1, requestId, payload: { previewId: accepted.data.previewId } }, true, rootId, jobs);
  assert.ok(status.ok); assert.equal(status.data.status, 'completed'); assert.ok(isPreviewResult(status, requestId, 'mods:maintenancePreviewStatus'));
  const leaked = structuredClone(status.data.result!); leaked.filename = '../private.jar';
  assert.equal(isMaintenanceDisplay(leaked), false);
  assert.equal(isPreviewData({ ...status.data, result: leaked }, 'mods:maintenancePreviewStatus'), false);
  const wrongAction = structuredClone(status.data.result!); wrongAction.action = 'enable';
  assert.equal(isMaintenanceDisplay(wrongAction), false);
  const misleading = structuredClone(status.data.result!); misleading.platformFailures.push('NETWORK_FAILED');
  assert.equal(isMaintenanceDisplay(misleading), false);
  await jobs.close();
});
