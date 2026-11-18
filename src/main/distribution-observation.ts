import { DistributionStore } from '../services/distribution/store.js';
import { DistributionAdmissionReconciler } from '../services/distribution/reconciliation.js';
import { DistributionTaskViewError, DistributionTaskViewProvider } from '../services/distribution/task-views.js';
import { ensureChildDirectory } from '../services/install/instance-files.js';
import type { StorageClient } from '../services/workers/storage-client.js';

/** Application owner of the private ledger and its startup reconciliation barrier. */
export class DistributionObservationOwner {
  private active?: { rootId: string; open: Promise<DistributionTaskViewProvider> };
  private ledger?: DistributionStore;
  private reconciler?: DistributionAdmissionReconciler;
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

  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => {
      const provider = await this.active?.open.catch(() => undefined);
      try { await provider?.close(); }
      finally {
        try { await this.reconciler?.close(); }
        finally { await this.ledger?.close(); }
      }
    })();
  }
}
