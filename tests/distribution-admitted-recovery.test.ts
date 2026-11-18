import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { DistributionExecutionAdapter } from '../src/ipc/distribution-execution.js';
import { DistributionExecutionBackend } from '../src/services/distribution/backend.js';
import { DistributionExecutionCoordinator } from '../src/services/distribution/execution.js';
import { loadWindowsDistributionFiles } from '../src/services/distribution/native-files.js';
import { DistributionPreparationService } from '../src/services/distribution/preparation.js';
import { DistributionAdmissionReconciler } from '../src/services/distribution/reconciliation.js';
import { DistributionExecutionRunner } from '../src/services/distribution/runner.js';
import { DistributionTaskSettlementService } from '../src/services/distribution/settlement.js';
import { DistributionTaskViewProvider } from '../src/services/distribution/task-views.js';
import { DistributionStore } from '../src/services/distribution/store.js';
import { DistributionTransactionService } from '../src/services/distribution/transaction.js';
import { SimulatedDistributionCrash, transactionDigest } from '../src/services/distribution/transaction-record.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import type { StoredTask } from '../src/services/storage/tasks.js';
import { admittedExecutionFixture } from './helpers/distribution-admitted-execution-fixture.js';
import { ROOT } from './helpers/distribution-local-domain-fixture.js';

test('configured recovery transport returns the original task across native rollback and request replay', {
  skip: process.platform !== 'win32' || process.arch !== 'x64', timeout: 30000,
}, async () => {
  const fixture = await admittedExecutionFixture();
  const { rootId, txId, instanceId, instanceRevision, manifest } = fixture.plan;
  const taskId = fixture.accepted.taskId;
  let reopened: DistributionStore | undefined;
  let storage: StorageClient | undefined;
  let coordinator: DistributionExecutionCoordinator | undefined;
  let settlement: DistributionTaskSettlementService | undefined;
  let runner: DistributionExecutionRunner | undefined;
  let reconciler: DistributionAdmissionReconciler | undefined;
  let views: DistributionTaskViewProvider | undefined;
  let backend: DistributionExecutionBackend | undefined;
  let adapter: DistributionExecutionAdapter | undefined;
  try {
    const admission = await fixture.f.store.admissions.readByTask(taskId);
    assert.ok(admission);
    const requestId = randomUUID();
    await assert.rejects(fixture.f.store.admissions.bindRecoveryRequest(rootId, requestId, taskId), { code: 'NEEDS_RECOVERY' });
    await fixture.client.claimDistributionTask(rootId, txId, admission.inputDigest, taskId);
    const createFiles = await loadWindowsDistributionFiles(path.join(ROOT, 'native-build', 'native'));
    const readTarget = async () => ({ rootId, instanceId, revision: instanceRevision, gameDir: fixture.f.gameDir, environment: manifest.target });
    const transaction = new DistributionTransactionService({
      journals: fixture.f.store.journals,
      receipts: fixture.f.store.receipts,
      readTarget, isIdle: async () => true, canRecover: async () => false, createFiles,
      authorize: async (plan, signal) => {
        assert.equal(transactionDigest(plan), transactionDigest(admission.plan));
        await fixture.f.domain.validate(plan, signal);
      },
      artifact: (plan, index, signal) => fixture.f.domain.artifact(plan, index, signal),
      checkpoint: async point => { if (point === 'published') throw new SimulatedDistributionCrash(); },
    });
    await assert.rejects(transaction.commit(admission.plan), SimulatedDistributionCrash);
    assert.deepEqual(await readdir(path.join(fixture.f.gameDir, 'mods')), ['managed.jar']);
    assert.deepEqual(await fixture.f.store.admissions.bindRecoveryRequest(rootId, requestId, taskId), admission);
    await assert.rejects(fixture.f.store.admissions.bindReceiptAlias(rootId, requestId, txId, admission.inputDigest), { code: 'REVISION_CONFLICT' });
    await fixture.f.store.close();
    await fixture.client.close();

    const ledger = reopened = await DistributionStore.open(fixture.f.metadata);
    const client = storage = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url),
      path.join(fixture.f.base, 'task-owner'));
    assert.equal((await client.get(rootId, taskId))?.execution.state, 'needsRecovery');
    assert.deepEqual(await ledger.admissions.bindRecoveryRequest(rootId, requestId, taskId), admission);
    await assert.rejects(ledger.admissions.bindRecoveryRequest(rootId, requestId, randomUUID()), { code: 'REVISION_CONFLICT' });
    const readProjections = (root: string) => client.readDistributionTaskProjections(root);
    coordinator = new DistributionExecutionCoordinator({
      sources: [], store: ledger,
      admitted: {
        rootId, admissions: ledger.admissions, readProjections,
        claimDistributionTask: async () => { throw new Error('recovery cannot claim'); },
      },
      readTarget,
      isIdle: async () => true,
      validate: async () => { throw new Error('recovery cannot authorize a new release'); },
      artifact: async () => { throw new Error('recovery cannot fetch new bytes'); },
      createFiles,
    });
    settlement = new DistributionTaskSettlementService(rootId, {
      admissions: ledger.admissions, readProjections, journals: ledger.journals, receipts: ledger.receipts,
      updateTask: (...args) => client.update(...args),
    });
    const execution = runner = new DistributionExecutionRunner(rootId, {
      admissions: ledger.admissions, readProjections, coordinator, settlement,
      recovery: { journals: ledger.journals, coordinator },
    });
    await assert.rejects(runner.run(txId, taskId), { code: 'NEEDS_RECOVERY' });
    reconciler = new DistributionAdmissionReconciler(rootId, {
      admissions: ledger.admissions, readProjections, project: (...args) => client.projectDistributionTask(...args),
    });
    const ready = reconciler.reconcile().then(() => {});
    views = new DistributionTaskViewProvider(rootId, { admissions: ledger.admissions, storage: client, ready: () => ready });
    let recoveries = 0;
    let startRecovery!: (result: Promise<StoredTask>) => void;
    const recovery = new Promise<StoredTask>(resolve => { startRecovery = resolve; });
    void recovery.catch(() => {});
    backend = new DistributionExecutionBackend(rootId, {
      available: () => true, admissions: ledger.admissions, views,
      preparation: new DistributionPreparationService(coordinator),
      confirmation: { confirm: async () => { throw new Error('recovery cannot confirm a new job'); } },
      runner: {
        run: async () => { throw new Error('recovery cannot execute a new job'); },
        recover: (...args) => {
          recoveries++;
          const result = execution.recover(...args);
          startRecovery(result);
          return result;
        },
      },
    });
    adapter = new DistributionExecutionAdapter(backend.document());
    const request = { contractVersion: 1, requestId, payload: { taskId } };
    const accepted = await adapter.handle('distribution:recoverExecution', request, () => true, randomUUID());
    assert.ok(accepted.ok && 'recoveryRequestId' in accepted.data);
    assert.equal(accepted.data.recoveryRequestId, requestId);
    assert.equal(accepted.data.snapshot.taskId, taskId);
    assert.equal(accepted.data.snapshot.state, 'needsRecovery');
    const rolledBack = await recovery;
    assert.equal(rolledBack.execution.state, 'failed');
    assert.deepEqual(await readdir(path.join(fixture.f.gameDir, 'mods')), []);
    assert.equal((await ledger.journals.read(txId))?.data.phase, 'rolledBack');
    const replay = new DistributionExecutionAdapter(backend.document());
    try {
      const receipt = await replay.handle('distribution:recoverExecution', request, () => true, randomUUID());
      assert.ok(receipt.ok && 'recoveryRequestId' in receipt.data);
      assert.equal(receipt.data.recoveryRequestId, requestId);
      assert.equal(receipt.data.snapshot.state, 'failed');
      assert.equal(receipt.data.snapshot.taskId, taskId);
      assert.equal(recoveries, 1);
    } finally { await replay.close(); }
    assert.deepEqual(await ledger.admissions.bindRecoveryRequest(rootId, requestId, taskId), admission);
  } finally {
    await adapter?.close();
    await backend?.close();
    await views?.close();
    await reconciler?.close();
    await runner?.close();
    await settlement?.close();
    await coordinator?.close();
    await storage?.close();
    await reopened?.close();
    await fixture.close();
  }
});
