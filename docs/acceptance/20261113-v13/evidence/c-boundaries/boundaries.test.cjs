const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { MaintenancePreviewJobs, presentMaintenancePreview, isMaintenanceDisplay, ModContractError } = require('./modules.cjs');
const rootId = '70000000-0000-4000-8000-000000000001';
const instanceId = '70000000-0000-4000-8000-000000000002';
const digest = text => createHash('sha256').update(text).digest('hex');
const fileId = digest('target');
const input = { rootId, instanceId, expectedRevision: 1, expectedFingerprint: digest('inventory'), fileId, action: 'disable' };
const settle = () => new Promise(resolve => setImmediate(resolve));
function preview() {
  const local = () => ({ state: 'satisfied', issues: [], providers: [] });
  const platform = () => ({ state: 'satisfied', issues: [], files: [] });
  return { rootId, instanceId, instanceRevision: 1, fingerprint: input.expectedFingerprint, filename: 'synthetic.jar', sha256: digest('bytes'),
    platformFailures: [], impact: { fileId, action: 'disable', state: 'ready', before: { local: local(), platform: platform() },
      after: { local: local(), platform: platform() }, affectedProviders: [], introducedIssues: [], resolvedIssues: [],
      directRequiredBy: [], transitiveRequiredBy: [], relations: [], truncated: false } };
}
function mixed() {
  const result = preview();
  result.impact.affectedProviders = Array.from({ length: 80 }, (_, i) => ({ fileId, id: `provider_${i}`, ownerId: `provider_${i}`, version: '1', via: [] }));
  result.impact.before.local.issues = Array.from({ length: 40 }, (_, i) => ({ severity: 'warning', code: 'SYNTHETIC_WARNING', fileId: digest(`local-${i}`),
    modId: 'some_mod', dependencyId: 'base_mod', expected: '>=1', actual: ['1'], via: [] }));
  result.impact.after.platform.issues = Array.from({ length: 40 }, (_, i) => ({ severity: 'warning', code: 'SYNTHETIC_WARNING', fileId: digest(`platform-${i}`),
    dependencyProjectId: 'Project1', dependencyVersionId: 'Version1' }));
  result.impact.relations = Array.from({ length: 80 }, (_, i) => ({ scope: 'local', dependentFileId: digest(`relation-${i}`), providerFileId: fileId,
    optional: true, selector: 'some_mod', via: [] }));
  result.impact.directRequiredBy = Array.from({ length: 128 }, (_, i) => digest(`direct-${i}`));
  result.impact.transitiveRequiredBy = Array.from({ length: 143 }, (_, i) => digest(`transitive-${i}`));
  result.platformFailures = ['NETWORK_FAILED'];
  return result; // 80 providers + 80 issues + 80 relations + 128 direct + 143 transitive + 1 failure =512.
}
const count = display => ['providers', 'issues', 'relations', 'directRequiredBy', 'transitiveRequiredBy', 'platformFailures']
  .reduce((sum, key) => sum + display[key].length, 0);

test('C-R7 mixed six-list total512 is exact, complete and not falsely truncated', () => {
  const original = mixed(), snapshot = structuredClone(original), result = presentMaintenancePreview(original);
  assert.equal(count(result), 512); assert.equal(result.incomplete, false);
  assert.equal(result.state, 'unknown'); // Actual platform failure still forces unknown, independently of budget.
  assert.deepEqual(['providers','issues','relations','directRequiredBy','transitiveRequiredBy','platformFailures'].map(key => result[key].length), [80,80,80,128,143,1]);
  assert.equal(isMaintenanceDisplay(result), true); assert.deepEqual(original, snapshot);
});
test('C-R7 mixed total512 without failures can remain ready; 513 is incomplete/unknown and bounded512', () => {
  const original = mixed(); original.platformFailures = [];
  original.impact.affectedProviders.push({ fileId, id: 'extra_provider', ownerId: 'extra_provider', version: '1', via: [] });
  const exact = presentMaintenancePreview(original);
  assert.equal(count(exact), 512); assert.equal(exact.incomplete, false); assert.equal(exact.state, 'ready');
  assert.equal(isMaintenanceDisplay(exact), true);
  original.platformFailures.push('NETWORK_FAILED'); // The 513th item is attempted after all other lists.
  const overflow = presentMaintenancePreview(original);
  assert.equal(count(overflow), 512); assert.equal(overflow.incomplete, true); assert.equal(overflow.state, 'unknown');
  assert.equal(overflow.platformFailures.length, 0); assert.equal(isMaintenanceDisplay(overflow), true);
});
test('C-R7 mixed six-list total513 truncates the extra failure and preserves blocked', () => {
  const original = mixed(); original.platformFailures.push('NOT_FOUND'); original.impact.state = 'blocked';
  const result = presentMaintenancePreview(original);
  assert.equal(count(result), 512); assert.equal(result.incomplete, true); assert.equal(result.state, 'blocked');
  assert.deepEqual(result.platformFailures, ['NETWORK_FAILED']); assert.equal(isMaintenanceDisplay(result), true);
});

for (const terminal of ['completed', 'failed', 'cancelled']) {
  test(`C-R8 sixteen ${terminal} unexpired observations remain readable; seventeenth is SCAN_BUSY`, async () => {
    let clock = 0, calls = 0;
    const jobs = new MaintenancePreviewJobs({ preview: async () => { calls++; if (terminal === 'failed') throw new ModContractError('SCAN_FAILED'); return preview(); } }, () => clock);
    const accepted = [];
    try {
      for (let i = 0; i < 16; i++) {
        const requestId = randomUUID(), item = jobs.start(requestId, input); accepted.push({ requestId, ...item });
        if (terminal === 'cancelled') assert.equal((await jobs.cancel(item.previewId)).status, terminal);
        else await settle();
        assert.equal(jobs.get(item.previewId).status, terminal);
      }
      const expectedCalls = terminal === 'cancelled' ? 0 : 16;
      assert.equal(calls, expectedCalls); assert.throws(() => jobs.start(randomUUID(), input), { code: 'SCAN_BUSY' });
      clock = 899999;
      for (const item of accepted) {
        assert.equal(jobs.get(item.previewId).status, terminal);
        assert.deepEqual(jobs.start(item.requestId, input), { previewId: item.previewId });
      }
      assert.throws(() => jobs.start(randomUUID(), input), { code: 'SCAN_BUSY' }); assert.equal(calls, expectedCalls);
      clock = 900000;
      for (const item of accepted) assert.throws(() => jobs.get(item.previewId), { code: 'PREVIEW_EXPIRED' });
      const next = jobs.start(randomUUID(), input);
      if (terminal === 'cancelled') await jobs.cancel(next.previewId); else await settle();
      assert.equal(jobs.get(next.previewId).status, terminal);
      assert.equal(calls, expectedCalls + (terminal === 'cancelled' ? 0 : 1));
    } finally { await jobs.close(); }
  });
}

for (const terminal of ['failed', 'cancelled']) {
  test(`C-R8 ${terminal} TTL boundary899999/900000 expires status/cancel/same-request without rerun`, async () => {
    let clock = 100, calls = 0;
    const jobs = new MaintenancePreviewJobs({ preview: async () => { calls++; throw new ModContractError('SCAN_FAILED'); } }, () => clock);
    const requestId = randomUUID();
    try {
      const item = jobs.start(requestId, input);
      if (terminal === 'cancelled') await jobs.cancel(item.previewId); else await settle();
      const snapshot = jobs.get(item.previewId); assert.equal(snapshot.status, terminal); assert.equal(snapshot.result, null);
      assert.equal(snapshot.errorCode, terminal === 'failed' ? 'SCAN_FAILED' : null);
      const beforeCalls = calls; clock = 900099;
      assert.equal(jobs.get(item.previewId).status, terminal);
      assert.equal((await jobs.cancel(item.previewId)).status, terminal);
      assert.equal(jobs.start(requestId, input).previewId, item.previewId);
      clock = 900100;
      assert.throws(() => jobs.get(item.previewId), { code: 'PREVIEW_EXPIRED' });
      await assert.rejects(jobs.cancel(item.previewId), { code: 'PREVIEW_EXPIRED' });
      assert.throws(() => jobs.start(requestId, input), { code: 'PREVIEW_EXPIRED' }); assert.equal(calls, beforeCalls);
      const next = jobs.start(randomUUID(), input); await settle(); assert.notEqual(next.previewId, item.previewId);
      assert.equal(calls, beforeCalls + 1);
    } finally { await jobs.close(); }
  });
}

test('C-R8 tombstones4095 still admits one, 4096 rejects new, old IDs never revive; restart clears bound', async t => {
  let clock = 0, calls = 0;
  const service = { preview: async () => { calls++; return preview(); } };
  const jobs = new MaintenancePreviewJobs(service, () => clock);
  const old = [];
  try {
    for (let i = 0; i < 4095; i++) {
      const requestId = randomUUID(), item = jobs.start(requestId, input); old.push({ requestId, ...item }); await settle();
      assert.equal(jobs.get(item.previewId).status, 'completed'); clock += 900000;
      assert.throws(() => jobs.get(item.previewId), { code: 'PREVIEW_EXPIRED' });
    }
    assert.equal(calls, 4095);
    const requestId = randomUUID(), last = jobs.start(requestId, input); // Admission with exactly4095 tombstones.
    await settle(); assert.equal(calls, 4096); assert.equal(jobs.get(last.previewId).status, 'completed');
    assert.deepEqual(jobs.start(requestId, input), last); // Still readable/idempotent before terminal TTL.
    clock += 900000; assert.throws(() => jobs.get(last.previewId), { code: 'PREVIEW_EXPIRED' });
    const rejected = randomUUID(); assert.throws(() => jobs.start(rejected, input), { code: 'SCAN_BUSY' });
    assert.throws(() => jobs.start(old[0].requestId, input), { code: 'PREVIEW_EXPIRED' });
    assert.throws(() => jobs.start(requestId, input), { code: 'PREVIEW_EXPIRED' });
    assert.throws(() => jobs.get(old[0].previewId), { code: 'PREVIEW_EXPIRED' }); assert.equal(calls, 4096);
    await jobs.close();
    const restarted = new MaintenancePreviewJobs(service, () => clock);
    try {
      assert.throws(() => restarted.get(last.previewId), { code: 'PREVIEW_EXPIRED' });
      const fresh = restarted.start(rejected, input); await settle(); assert.equal(restarted.get(fresh.previewId).status, 'completed');
      assert.notEqual(fresh.previewId, last.previewId); assert.equal(calls, 4097);
    } finally { await restarted.close(); }
    t.diagnostic('4096 tombstones reached only via public start/get and injected constructor clock; no private-state/Map mutation.');
  } finally { await jobs.close(); }
});
