import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
import { DistributionExecutionAdapter } from '../src/ipc/distribution-execution.js';
import { DistributionExecutionBackend } from '../src/services/distribution/backend.js';
import { DistributionConfirmationService } from '../src/services/distribution/confirmation.js';
import { DistributionPreparationService } from '../src/services/distribution/preparation.js';
import { DistributionAdmissionReconciler } from '../src/services/distribution/reconciliation.js';
import { DistributionExecutionRunner } from '../src/services/distribution/runner.js';
import { DistributionTaskSettlementService } from '../src/services/distribution/settlement.js';
import { DistributionTaskViewProvider } from '../src/services/distribution/task-views.js';
import type { DistributionExecutionChannel, DistributionExecutionPayloads } from '../src/shared/contracts/distribution-execution.js';
import { admittedExecutionFixture } from './helpers/distribution-admitted-execution-fixture.js';

test('configured transport carries a confirmed document task through revocation, native execution and durable observation', {
  skip: process.platform !== 'win32' || process.arch !== 'x64', timeout: 30000,
}, async () => {
  const fixture = await admittedExecutionFixture();
  const { rootId, instanceId, sourceId, packageId, packageVersion } = fixture.plan;
  const client = fixture.client;
  const coordinator = fixture.coordinator;
  const { admissions, journals, receipts } = fixture.f.store;
  const readProjections = (root: string) => client.readDistributionTaskProjections(root);
  const reconciler = new DistributionAdmissionReconciler(rootId, {
    admissions, readProjections, project: (...args) => client.projectDistributionTask(...args),
  });
  const ready = reconciler.reconcile().then(() => {});
  const views = new DistributionTaskViewProvider(rootId, { admissions, storage: client, ready: () => ready });
  const preparation = new DistributionPreparationService(coordinator, () => 1794873600000);
  const confirmation = new DistributionConfirmationService(rootId, {
    admissions, readProjections, reconcile: () => reconciler.reconcile(), ticket: id => coordinator.ticket(id),
  });
  const settlement = new DistributionTaskSettlementService(rootId, {
    admissions, readProjections, journals, receipts, updateTask: (...args) => client.update(...args),
  });
  const runner = new DistributionExecutionRunner(rootId, { admissions, readProjections, coordinator, settlement });
  let ack!: () => void;
  let notify!: (taskId: string) => void;
  let completed!: () => void;
  let failed!: (error: Error) => void;
  const held = new Promise<void>(resolve => { ack = resolve; });
  const admitted = new Promise<string>(resolve => { notify = resolve; });
  const finished = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
  void finished.catch(() => {});
  const backend = new DistributionExecutionBackend(rootId, {
    available: () => true, admissions, preparation, views,
    confirmation: { confirm: async (...args) => {
      const result = await confirmation.confirm(...args);
      notify(result.taskId);
      await held;
      return result;
    } },
    runner: {
      run: async (...args) => { const result = await runner.run(...args); completed(); return result; },
      recover: (...args) => runner.recover(...args),
    },
    onJobFailure: () => failed(new Error('Distribution job failed')),
  });
  const owner = new DistributionExecutionAdapter(backend.document());
  const other = new DistributionExecutionAdapter(backend.document());
  const dispatch = <C extends DistributionExecutionChannel>(transport: DistributionExecutionAdapter, channel: C,
    payload: DistributionExecutionPayloads[C], requestId = randomUUID()) =>
    transport.handle(channel, { contractVersion: 1, requestId, payload }, () => true, randomUUID());
  try {
    const proposalId = randomUUID();
    const accepted = await dispatch(owner, 'distribution:prepareExecution', { rootId, instanceId, sourceId, packageId, packageVersion }, proposalId);
    assert.ok(accepted.ok && 'state' in accepted.data && accepted.data.state === 'pending');
    let prepared;
    for (let i = 0; i < 300; i++) {
      const response = await dispatch(owner, 'distribution:executionPreparation', { prepareRequestId: proposalId });
      assert.ok(response.ok && 'state' in response.data);
      if (response.data.state === 'ready') { prepared = response.data.proposal; break; }
      assert.equal(response.data.state, 'pending');
      await setTimeout(10);
    }
    assert.ok(prepared);
    const input = { proposalId, instanceRevision: prepared.instanceRevision, sequence: prepared.sequence };
    const stolen = await dispatch(other, 'distribution:confirmExecution', input);
    assert.ok(!stolen.ok);
    assert.equal(stolen.error.code, 'INVALID_ARGUMENT');
    const requestId = randomUUID();
    const inFlight = dispatch(owner, 'distribution:confirmExecution', input, requestId);
    const taskId = await Promise.race([admitted, inFlight.then(response => { throw new Error(JSON.stringify(response)); })]);
    owner.dispose();
    ack();
    const missed = await inFlight;
    assert.ok(!missed.ok && missed.error.code === 'INVALID_SENDER');
    await finished;
    const receipt = await dispatch(other, 'distribution:confirmExecution', input, requestId);
    assert.ok(receipt.ok && 'snapshot' in receipt.data);
    assert.equal(receipt.data.snapshot.taskId, taskId);
    assert.equal(receipt.data.snapshot.state, 'completed');
    assert.equal((await views.get(taskId))?.snapshot.state, 'completed');
    assert.equal(fixture.counts().claims, 1);
  } finally {
    ack();
    await owner.close();
    await other.close();
    await backend.close();
    await runner.close();
    await views.close();
    await settlement.close();
    await confirmation.close();
    await reconciler.close();
    await fixture.close();
  }
});
