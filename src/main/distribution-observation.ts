import { DistributionStore } from '../services/distribution/store.js';
import { DistributionAdmissionReconciler } from '../services/distribution/reconciliation.js';
import { DistributionTaskViewError, DistributionTaskViewProvider } from '../services/distribution/task-views.js';
import { ensureChildDirectory } from '../services/install/instance-files.js';
import type { StorageClient } from '../services/workers/storage-client.js';
import { InstanceContractError } from '../shared/contracts/instances.js';
import { createExecution } from '../core/task/machine.js';
import { transactionDigest } from '../services/distribution/transaction-record.js';

/** Application owner of the private ledger and its startup reconciliation barrier. */
export class DistributionObservationOwner {
  private active?: { rootId: string; open: Promise<DistributionTaskViewProvider> };
  private ledger?: DistributionStore;
  private reconciler?: DistributionAdmissionReconciler;
  private readonly cancellations = new Map<string, Promise<boolean>>();
  private closed = false;
  private closing?: Promise<void>;

  constructor(private readonly metadataDirectory: string, private readonly storage: StorageClient) {}

  private async open(rootId: string): Promise<DistributionTaskViewProvider> {
    try {
      const registration = await this.storage.readInstallation();
      if (registration?.data.rootId.toLowerCase() !== rootId) throw new DistributionTaskViewError('ROOT_UNAVAILABLE');
      const directory = await ensureChildDirectory(this.metadataDirectory, 'distribution');
      const ledger = await DistributionStore.open(directory);
      this.ledger = ledger;
      const admissions = ledger.admissions;
      const reconciler = new DistributionAdmissionReconciler(rootId, {
        admissions,
        readProjections: root => this.storage.readDistributionTaskProjections(root),
        project: (...args) => this.storage.projectDistributionTask(...args),
      });
      this.reconciler = reconciler;
      const ready = reconciler.reconcile().then(() => {});
      await ready;
      return new DistributionTaskViewProvider(rootId, { admissions, storage: this.storage, ready: () => ready });
    } catch (error) {
      await this.reconciler?.close();
      await this.ledger?.close();
      if (error instanceof DistributionTaskViewError) throw error;
      throw new DistributionTaskViewError('NEEDS_RECOVERY');
    }
  }

  private provider(rootId: string): Promise<DistributionTaskViewProvider> {
    if (this.closed) return Promise.reject(new DistributionTaskViewError('UNAVAILABLE'));
    if (this.active && this.active.rootId !== rootId) return Promise.reject(new DistributionTaskViewError('ROOT_UNAVAILABLE'));
    return (this.active ??= { rootId, open: this.open(rootId) }).open;
  }

  async get(rootId: string, taskId: string) {
    const task = await this.storage.get(rootId, taskId);
    if (task && task.kind !== 'distribution-install') return;
    return (await this.provider(rootId)).get(taskId);
  }

  async list(rootId: string) { return (await this.provider(rootId)).list(); }
  async targets(instanceId: string, rootId: string) { return (await this.provider(rootId)).targets(instanceId); }

  /** Cancels only a proven never-started distribution task using the task store's revision CAS. */
  cancelQueued(rootId: string, taskId: string): Promise<boolean> {
    if (this.closed) return Promise.reject(new DistributionTaskViewError('UNAVAILABLE'));
    const key = `${rootId}/${taskId}`;
    const pending = this.cancellations.get(key);
    if (pending) return pending;
    if (this.cancellations.size >= 8) return Promise.reject(new DistributionTaskViewError('CAPACITY_EXCEEDED'));
    const operation = this.cancelBeforeStart(rootId, taskId).finally(() => this.cancellations.delete(key));
    this.cancellations.set(key, operation);
    return operation;
  }

  private async cancelBeforeStart(rootId: string, taskId: string): Promise<boolean> {
    if ((await this.storage.get(rootId, taskId))?.kind !== 'distribution-install') return false;
    const provider = await this.provider(rootId);
    const ledger = this.ledger;
    const view = await provider.get(taskId);
    const record = await ledger?.admissions.readByTask(taskId);
    if (!ledger || !view || record?.phase !== 'projected' || record.plan.rootId !== rootId) {
      throw new DistributionTaskViewError('NEEDS_RECOVERY');
    }
    if (view.snapshot.state === 'completed' || view.snapshot.state === 'committing') throw new InstanceContractError('CANCEL_TOO_LATE');
    if (view.snapshot.state !== 'queued' && view.snapshot.state !== 'cancelled') throw new InstanceContractError('INVALID_TASK_STATE');
    if (await ledger.journals.read(record.proposalId)) throw new DistributionTaskViewError('NEEDS_RECOVERY');
    const initial = createExecution();
    const cancelled = { ...initial, state: 'cancelled' as const, revision: initial.revision + 1 };
    const current = await this.storage.findAccepted(rootId, record.proposalId, 'distribution-install', record.inputDigest);
    if (!current || current.taskId !== taskId) throw new DistributionTaskViewError('NEEDS_RECOVERY');
    if (transactionDigest(current.execution) === transactionDigest(cancelled)) return true;
    if (transactionDigest(current.execution) !== transactionDigest(initial)) throw new InstanceContractError('INVALID_TASK_STATE');
    try { await this.storage.update(rootId, taskId, initial.revision, cancelled); }
    catch { /* The commit acknowledgement may have been lost. Read back the exact outcome. */ }
    const saved = await this.storage.findAccepted(rootId, record.proposalId, 'distribution-install', record.inputDigest);
    if (!saved || saved.taskId !== taskId) throw new DistributionTaskViewError('NEEDS_RECOVERY');
    if (transactionDigest(saved.execution) === transactionDigest(cancelled)) return true;
    if (saved.execution.state === 'committing' || saved.execution.state === 'completed') throw new InstanceContractError('CANCEL_TOO_LATE');
    if (saved.execution.state === 'running') throw new InstanceContractError('INVALID_TASK_STATE');
    throw new DistributionTaskViewError('NEEDS_RECOVERY');
  }

  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => {
      await Promise.allSettled([...this.cancellations.values()]);
      const provider = await this.active?.open.catch(() => undefined);
      try { await provider?.close(); }
      finally {
        try { await this.reconciler?.close(); }
        finally { await this.ledger?.close(); }
      }
    })();
  }
}
