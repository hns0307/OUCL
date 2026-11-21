import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, unlink } from 'node:fs/promises';
import path from 'node:path';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { ModTaskService } from '../src/services/mods/tasks.js';
import { parseReply, parseStorageRequest } from '../src/services/workers/protocol.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';
import { modPlanDigest, modPlanInputDigest } from '../src/services/mods/plan-identity.js';
import type { ModInstallPlan, ModPayloads } from '../src/shared/contracts/mods.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001';
const a = '00000000-0000-4000-8000-000000000002';
const b = '00000000-0000-4000-8000-000000000003';

test('ready feature is optional and strict; target requests are bounded', () => {
  assert.deepEqual(parseReply({ version: 1, kind: 'ready' }), { version: 1, kind: 'ready' });
  assert.deepEqual(parseReply({ version: 1, kind: 'ready', features: ['mod-targets.read.v1'] }), { version: 1, kind: 'ready', features: ['mod-targets.read.v1'] });
  assert.throws(() => parseReply({ version: 1, kind: 'ready', features: ['unknown'] }));
  assert.throws(() => parseStorageRequest({ version: 1, id: randomUUID(), command: { kind: 'mod-targets:read', rootId, rootRevision: 1, instanceId: a, kinds: ['mod-check', 'mod-check'] } }));
});

test('worker proves per-instance Mod targets after reopening and fails closed on orphaned admission', async () => {
  const base = await mkdtemp(path.resolve('tmp', 'oucl-targets-')); const metadata = path.join(base, 'metadata'); const games = path.join(base, 'games');
  await mkdir(metadata); await mkdir(games);
  let client = await StorageClient.open(entry, metadata);
  try {
    assert.equal(client.supportsModTargets, true);
    await client.createInstallation({ rootId, dataDirectory: games });
    await client.writeInstance(a, 0, modReadyInstance(rootId, a)); await client.writeInstance(b, 0, modReadyInstance(rootId, b));
    const rows = [];
    for (const instanceId of [a, b]) {
      const requestId = randomUUID(); const payloadDigest = createHash('sha256').update(JSON.stringify({ instanceId, expectedRevision: 1, mode: 'check' })).digest('hex');
      const task = await client.accept(rootId, requestId, 'mod-check', payloadDigest);
      rows.push({ taskId: task.taskId, requestId, payloadDigest, instanceId, instanceRevision: 1, mode: 'check' as const,
        stage: 'queued' as const, reportRevision: 0 as const, errorCode: null });
    }
    await client.writeModJobs(0, { formatVersion: 1, rootId, items: rows });
    assert.deepEqual((await client.readModTargets({ rootId, rootRevision: 1, instanceId: b, kinds: ['mod-check'] })).items.map(item => item.task.taskId), [rows[1]!.taskId]);
    await client.close(); client = await StorageClient.open(entry, metadata);
    assert.deepEqual((await client.readModTargets({ rootId, rootRevision: 1, instanceId: a, kinds: ['mod-check'] })).items.map(item => item.task.taskId), [rows[0]!.taskId]);
    await assert.rejects(client.readModTargets({ rootId, rootRevision: 2, instanceId: a, kinds: ['mod-check'] }), { code: 'TARGET_ROOT_CHANGED' });
    await assert.rejects(client.readModTargets({ rootId, rootRevision: 1, instanceId: randomUUID(), kinds: ['mod-check'] }), { code: 'TARGET_OUT_OF_SCOPE' });
    await client.accept(rootId, randomUUID(), 'mod-check', 'a'.repeat(64));
    await assert.rejects(client.readModTargets({ rootId, rootRevision: 1, instanceId: b, kinds: ['mod-check'] }), { code: 'NEEDS_RECOVERY' });
  } finally { await client.close(); }
});

test('worker derives Mod installation targets from each immutable confirmed plan after restart', async () => {
  const base = await mkdtemp(path.resolve('tmp', 'oucl-install-targets-')); const metadata = path.join(base, 'metadata'); const games = path.join(base, 'games');
  await mkdir(metadata); await mkdir(games); let client = await StorageClient.open(entry, metadata);
  try {
    await client.createInstallation({ rootId, dataDirectory: games });
    const ids: string[] = []; const planRequests: string[] = [];
    for (const instanceId of [a, b]) {
      await client.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
      const input: ModPayloads['mods:plan'] = { instanceId, expectedRevision: 1, root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: 'a'.repeat(40) }, selections: {} };
      const body: Omit<ModInstallPlan, 'planId'> = { formatVersion: 1, instanceId, instanceRevision: 1, fingerprint: 'b'.repeat(64), minecraft: '1.20.1', loader: 'fabric', rootVersionId: 'RootVer1', state: 'ready', attempts: 1, totalDownloadBytes: 0,
        items: [{ projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', fileId: 'a'.repeat(40), sha512: 'c'.repeat(128), size: 1, disposition: 'library', requiredBy: [] }], issues: [] };
      const plan = { ...body, planId: modPlanDigest(body) }; const requestId = randomUUID();
      planRequests.push(requestId);
      await client.writeModPlan(requestId, 0, { formatVersion: 1, rootId, requestId, payloadDigest: modPlanInputDigest(input), input, plan, status: 'preview' });
      ids.push((await client.acceptModConfirmation(requestId, plan.planId, true)).taskId);
    }
    await client.close(); client = await StorageClient.open(entry, metadata);
    for (const [index, instanceId] of [a, b].entries()) {
      const result = await client.readModTargets({ rootId, rootRevision: 1, instanceId, kinds: ['mod-install'] });
      assert.deepEqual(result.items.map(item => item.task.taskId), [ids[index]]); assert.equal(result.items[0]!.instanceRevision, 1);
    }
    // The missing plan belongs to A, but the B query still cannot claim its domain is complete.
    await unlink(path.join(metadata, `mod-plan-${planRequests[0]}.json`));
    await assert.rejects(client.readModTargets({ rootId, rootRevision: 1, instanceId: b, kinds: ['mod-install'] }), { code: 'NEEDS_RECOVERY' });
  } finally { await client.close(); }
});

test('target read waits through the actual SQL admission to Mod index commit gap', async () => {
  const base = await mkdtemp(path.resolve('tmp', 'oucl-admission-gap-')); const metadata = path.join(base, 'metadata'); const games = path.join(base, 'games');
  await mkdir(metadata); await mkdir(games); const client = await StorageClient.open(entry, metadata);
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const paused = new Promise<void>(resolve => { entered = resolve; });
  try {
    await client.createInstallation({ rootId, dataDirectory: games }); const record = modReadyInstance(rootId, a);
    await client.writeInstance(a, 0, record); await client.writeInstances(0, { items: [record.summary] });
    const write = client.writeModJobs.bind(client); let first = true;
    client.writeModJobs = async (revision, data) => { if (first) { first = false; entered(); await gate; } return write(revision, data); };
    const service = new ModTaskService(client, { scan: async () => { throw new Error('fixture scan unavailable'); } }, { check: async () => { throw new Error('fixture check unavailable'); } });
    try {
      const admission = service.start(randomUUID(), 'list', { instanceId: a, expectedRevision: 1 }); await paused;
      let finished = false;
      const read = service.withTargetRead(() => client.readModTargets({ rootId, rootRevision: 1, instanceId: a, kinds: ['mod-check'] })).then(value => { finished = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(finished, false);
      release(); const accepted = await admission; const result = await read;
      assert.deepEqual(result.items.map(item => item.task.taskId), [accepted.taskId]);
    } finally { release(); await service.close(); }
  } finally { await client.close(); }
});
