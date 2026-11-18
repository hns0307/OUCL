import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { TargetAdapter } from '../src/ipc/task-targets.js';
import { DistributionObservationOwner } from '../src/main/distribution-observation.js';
import { DistributionStore } from '../src/services/distribution/store.js';
import type { ModInstallTaskService } from '../src/services/mods/install-tasks.js';
import type { ModTaskService } from '../src/services/mods/tasks.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';
import { admittedExecutionFixture } from './helpers/distribution-admitted-execution-fixture.js';

test('the application owner reconciles persisted admissions before exposing task and target observations', {
  skip: process.platform !== 'win32' || process.arch !== 'x64',
}, async () => {
  const fixture = await admittedExecutionFixture();
  const { rootId, instanceId, sourceId, packageId, packageVersion } = fixture.plan;
  const directory = path.join(fixture.f.base, 'distribution');
  const owner = new DistributionObservationOwner(fixture.f.base, fixture.client);
  const adapter = new TargetAdapter(fixture.client, {} as ModTaskService, {} as ModInstallTaskService, owner);
  try {
    await fixture.client.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
    const proposalId = randomUUID();
    await fixture.coordinator.prepare(proposalId, { rootId, instanceId, sourceId, packageId, packageVersion });
    const pending = await fixture.f.store.admissions.admit({
      ...await fixture.coordinator.ticket(proposalId), confirmRequestId: randomUUID(),
    });
    assert.equal(pending.phase, 'accepted');
    assert.equal(await fixture.client.get(rootId, pending.taskId), undefined);
    await fixture.f.store.close();
    await rename(fixture.f.metadata, directory);

    const [view, targets] = await Promise.all([
      owner.get(rootId, pending.taskId),
      adapter.handle({
        contractVersion: 1, requestId: randomUUID(),
        payload: { instanceId, kinds: ['distribution-install'], limit: 10 },
      }, true, 1, randomUUID()),
    ]);
    assert.equal(view?.snapshot.state, 'queued');
    assert.ok(targets.ok);
    assert.equal(targets.data.items.length, 2);
    const projected = targets.data.items.find(row => row.task.taskId === pending.taskId);
    assert.deepEqual(projected?.task, view?.snapshot);
    assert.equal((await owner.list(rootId)).length, 2);
    await assert.rejects(owner.list(randomUUID()), { code: 'ROOT_UNAVAILABLE' });
    await owner.close();
    await assert.rejects(owner.list(rootId), { code: 'UNAVAILABLE' });
    const reopened = await DistributionStore.open(directory);
    try {
      assert.equal((await reopened.admissions.readByTask(pending.taskId))?.phase, 'projected');
      assert.equal(await reopened.journals.read(proposalId), undefined);
    } finally { await reopened.close(); }
  } finally {
    adapter.close();
    try { await owner.close(); } finally { await fixture.close(); }
  }
});
