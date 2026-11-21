import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { RecordStore } from '../src/services/storage/records.js';
import { controlTask } from '../src/core/task/machine.js';
import { modReportRecordId, parseModJobs, parseStoredModReport } from '../src/services/storage/mod-jobs.js';
import type { ModJobs, StoredModReport } from '../src/services/storage/mod-jobs.js';
import type { ModReport } from '../src/shared/contracts/mods-report.js';
import { isModPayload, isModData, isModResult, modFailure } from '../src/shared/contracts/mods.js';
import { parseStorageRequest } from '../src/services/workers/protocol.js';
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
const report = (): ModReport => ({ formatVersion: 1, instanceId, instanceRevision: 1, fingerprint: 'a'.repeat(64), checkedAt: '2026-10-26T00:00:00.000Z',
  mode: 'check', localState: 'satisfied', state: 'satisfied', files: [], issues: [] });

test('Mod requests and responses admit only controlled instance/task identities and validated reports', () => {
  const payload = { instanceId, expectedRevision: 1 };
  for (const channel of ['mods:list', 'mods:check'] as const) {
    assert.ok(isModPayload(payload, channel));
    for (const invalid of [{ ...payload, path: 'D:/game' }, { ...payload, command: 'run' }, { ...payload, instanceId: '../file' }, { ...payload, expectedRevision: 0 }]) assert.equal(isModPayload(invalid, channel), false);
  }
  const requestId = randomUUID();
  assert.ok(isModPayload({ taskId: requestId }, 'mods:report')); assert.equal(isModPayload({ path: 'file' }, 'mods:report'), false);
  assert.ok(isModData({ taskId: requestId }, 'mods:check')); assert.ok(isModData({ report: report(), errorCode: null }, 'mods:report'));
  assert.equal(isModData({ report: report(), errorCode: 'SCAN_FAILED' }, 'mods:report'), false);
  const failure = modFailure<'mods:check'>(requestId, 'FILES_CHANGED', randomUUID()); assert.ok(isModResult(failure, requestId, 'mods:check'));
  assert.equal(isModResult({ ...failure, contractVersion: 2 }, requestId, 'mods:check'), false);
  assert.equal(isModResult({ ...failure, error: { code: 'RAW_STACK', message: 'private' } }, requestId, 'mods:check'), false);
});

test('real worker durably saves Mod jobs and immutable reports, preserving task identity across restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-mod-jobs-')); let storage = await StorageClient.open(entry, root);
  const requestId = randomUUID(); let taskId!: string;
  try {
    const task = await storage.accept(rootId, requestId, 'mod-check', 'a'.repeat(64)); taskId = task.taskId;
    const data: ModJobs = { formatVersion: 1, rootId, items: [{ taskId, requestId, payloadDigest: 'a'.repeat(64), instanceId, instanceRevision: 1,
      mode: 'check', stage: 'queued', reportRevision: 0, errorCode: null }] };
    assert.equal((await storage.writeModJobs(0, data)).revision, 1);
    const stored: StoredModReport = { formatVersion: 1, rootId, taskId, report: report() };
    assert.equal((await storage.writeModReport(taskId, stored)).revision, 1);
    await assert.rejects(storage.writeModReport(taskId, stored), { code: 'REVISION_CONFLICT' });
    await storage.update(rootId, taskId, task.execution.revision, controlTask(task.execution, 'start').execution);
    assert.deepEqual((await storage.readModReport(taskId))!.data, stored);
    assert.equal(await storage.readModReport(randomUUID()), undefined);
  } finally { await storage.close(); }
  storage = await StorageClient.open(entry, root);
  try {
    assert.equal((await storage.get(rootId, taskId))!.execution.state, 'needsRecovery');
    assert.equal((await storage.accept(rootId, requestId, 'mod-check', 'a'.repeat(64))).taskId, taskId);
    assert.equal((await storage.readModJobs())!.data.items[0]!.taskId, taskId);
    assert.ok((await storage.readModReport(taskId))!.data.report.formatVersion === 1);
  } finally { await storage.close(); }
});

test('unknown future Mod formats stop typed IO and remain byte-for-byte intact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-mod-future-')); const taskId = randomUUID();
  const store = await RecordStore.open(root);
  try {
    await store.recover();
    await store.write('mod-jobs', 0, { formatVersion: 2, rootId, future: 'preserve' }, value => value);
    await store.write(modReportRecordId(taskId), 0, { formatVersion: 2, rootId, taskId, future: 'preserve' }, value => value);
  } finally { await store.close(); }
  const indexFile = path.join(root, 'mod-jobs.json'); const reportFile = path.join(root, `${modReportRecordId(taskId)}.json`);
  const before = await Promise.all([readFile(indexFile), readFile(reportFile)]); const storage = await StorageClient.open(entry, root);
  try {
    await assert.rejects(storage.readModJobs(), { code: 'INVALID_RECORD' });
    await assert.rejects(storage.writeModJobs(1, { formatVersion: 1, rootId, items: [] }), { code: 'INVALID_RECORD' });
    await assert.rejects(storage.readModReport(taskId), { code: 'INVALID_RECORD' });
  } finally { await storage.close(); }
  assert.deepEqual(await Promise.all([readFile(indexFile), readFile(reportFile)]), before);
});

test('private Mod storage schemas reject arbitrary domains, overwrites and forged record associations', () => {
  const taskId = randomUUID();
  assert.throws(() => modReportRecordId('../path'));
  assert.throws(() => parseModJobs({ formatVersion: 2, rootId, items: [] }));
  assert.throws(() => parseStoredModReport({ formatVersion: 1, rootId, taskId, report: { ...report(), formatVersion: 2 } }));
  for (const command of [{ kind: 'mod-report:get', taskId: '../path' }, { kind: 'mod-jobs:get', path: 'arbitrary' },
    { kind: 'mod-report:set', taskId, expectedRevision: 1, data: { formatVersion: 1, rootId, taskId, report: report() } },
    { kind: 'mod-report:set', taskId, expectedRevision: 0, data: { formatVersion: 1, rootId, taskId: randomUUID(), report: report() } }]) {
    assert.throws(() => parseStorageRequest({ version: 1, id: randomUUID(), command }));
  }
});
