import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { RecordStore } from '../src/services/storage/records.js';
import { parseInstallation } from '../src/services/storage/installation.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { parseStorageRequest } from '../src/services/workers/protocol.js';

const digest = 'a'.repeat(64);
async function directory(): Promise<string> {
  const root = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp', 'distribution-task-claim');
  await mkdir(root, { recursive: true }); return mkdtemp(path.join(root, 'case-'));
}
test('real Store claim permits one pristine start and rejects wrong binding without changing queued state', async () => {
  const store = await RecordStore.open(await directory()); const owner = randomUUID(); const proposal = randomUUID(); const id = randomUUID();
  try {
    await store.recover(); const initial = await store.projectDistributionTask(owner, proposal, digest, id);
    for (const [root, request, hash, task] of [[randomUUID(), proposal, digest, id], [owner, randomUUID(), digest, id],
      [owner, proposal, 'b'.repeat(64), id], [owner, proposal, digest, randomUUID()]]) {
      await assert.rejects(store.claimDistributionTask(root!, request!, hash!, task!), { code: 'NEEDS_RECOVERY' });
      assert.deepEqual(await store.getTask(owner, id), initial);
    }
    const started = await store.claimDistributionTask(owner, proposal, digest, id);
    assert.deepEqual(started.execution, { state: 'running', attempt: 1, revision: 2, lastSequence: 0, bytesDone: 0 });
    await assert.rejects(store.claimDistributionTask(owner, proposal, digest, id), { code: 'NEEDS_RECOVERY' });
    assert.deepEqual(await store.getTask(owner, id), started);
  } finally { await store.close(); }
});
test('real Store non-pristine queued tasks cannot regain first-start permission through generic updates', async () => {
  const store = await RecordStore.open(await directory()); const owner = randomUUID();
  try {
    await store.recover();
    for (const patch of [{}, { attempt: 1 }, { lastSequence: 1 }, { bytesDone: 1 }, { bytesTotal: 0 }]) {
      const proposal = randomUUID(); const id = randomUUID(); const task = await store.projectDistributionTask(owner, proposal, digest, id);
      const changed = await store.updateTask(owner, id, 1, { ...task.execution, ...patch, revision: 2 });
      await assert.rejects(store.claimDistributionTask(owner, proposal, digest, id), { code: 'NEEDS_RECOVERY' });
      assert.deepEqual(await store.getTask(owner, id), changed);
    }
  } finally { await store.close(); }
});
test('a committed claim with lost acknowledgement is not replayed, including after real worker recovery', async () => {
  const root = await directory(); const owner = randomUUID(); const proposal = randomUUID(); const id = randomUUID();
  const store = await RecordStore.open(root);
  try { await store.recover(); await store.write('installation', 0, { rootId: owner, dataDirectory: root }, parseInstallation); }
  finally { await store.close(); }
  let client = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), root);
  try {
    await client.projectDistributionTask(owner, proposal, digest, id);
    await assert.rejects(client.claimDistributionTask(randomUUID(), proposal, digest, id), { code: 'NEEDS_RECOVERY' });
    assert.equal((await client.get(owner, id))?.execution.state, 'queued');
    const lostAck = async (): Promise<void> => { await client.claimDistributionTask(owner, proposal, digest, id); throw new Error('SYNTHETIC_ACK_LOSS'); };
    await assert.rejects(lostAck(), /SYNTHETIC_ACK_LOSS/);
    assert.equal((await client.get(owner, id))?.execution.state, 'running');
    await assert.rejects(client.claimDistributionTask(owner, proposal, digest, id), { code: 'NEEDS_RECOVERY' });
    await client.close(); client = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), root);
    assert.equal((await client.get(owner, id))?.execution.state, 'needsRecovery');
    await assert.rejects(client.claimDistributionTask(owner, proposal, digest, id), { code: 'NEEDS_RECOVERY' });
  } finally { await client.close(); }
});
test('claim private protocol rejects arbitrary owner and malformed bindings', () => {
  const command = { kind: 'distribution-task:claim', expectedRootId: randomUUID(), proposalId: randomUUID(), taskId: randomUUID(), payloadDigest: digest };
  assert.doesNotThrow(() => parseStorageRequest({ version: 1, id: randomUUID(), command }));
  for (const bad of [{ ...command, ownerId: randomUUID() }, { ...command, payloadDigest: 'invalid' }, { ...command, taskId: 'invalid' }]) {
    assert.throws(() => parseStorageRequest({ version: 1, id: randomUUID(), command: bad }), { code: 'INVALID_MESSAGE' });
  }
});
