import { DistributionExecutionBackend } from '../services/distribution/backend.js';
import { DistributionConfirmationService } from '../services/distribution/confirmation.js';
import { DistributionExecutionCoordinator } from '../services/distribution/execution.js';
import type { DistributionExecutionOptions } from '../services/distribution/execution.js';
import { loadWindowsDistributionFiles } from '../services/distribution/native-files.js';
import { DistributionPreparationService } from '../services/distribution/preparation.js';
import { PinnedReleaseSource } from '../services/distribution/release-source.js';
import { DistributionExecutionRunner } from '../services/distribution/runner.js';
import { DistributionTaskSettlementService } from '../services/distribution/settlement.js';
import type { DistributionAdmissionReconciler } from '../services/distribution/reconciliation.js';
import type { DistributionStore } from '../services/distribution/store.js';
import type { DistributionTaskViewProvider } from '../services/distribution/task-views.js';
import type { StorageClient } from '../services/workers/storage-client.js';

export type DistributionRuntimeConfiguration = Pick<DistributionExecutionOptions, 'sources' | 'readTarget' | 'isIdle' | 'artifact' | 'validate' | 'fetcher'>;

/** Publisher pins, trusted artifact lookup and redistribution policy must come from reviewed main configuration. */
export function configuredDistributionRuntime(): DistributionRuntimeConfiguration | undefined {
  return undefined;
}

/** Builds a root runtime only after the private stores and the protected helper have been verified. */
export async function openDistributionRuntime(rootId: string, storage: StorageClient, ledger: DistributionStore,
  reconciler: DistributionAdmissionReconciler, views: DistributionTaskViewProvider, nativeDirectory: string,
  config: DistributionRuntimeConfiguration) {
  const sources = structuredClone(config.sources);
  if (!sources.length || new Set(sources.map(source => source.sourceId)).size !== sources.length) throw new Error('SOURCE_UNAVAILABLE');
  for (const source of sources) {
    if (!source.keys.some(key => !key.revoked)) throw new Error('SOURCE_UNAVAILABLE');
    // Constructor validation is local. Opening the runtime performs no network requests.
    new PinnedReleaseSource(source, ledger, config.fetcher ? { fetcher: config.fetcher } : {});
  }
  const factory = await loadWindowsDistributionFiles(nativeDirectory);
  await reconciler.reconcile();
  const { admissions, receipts, journals } = ledger;
  const readProjections = (root: string) => storage.readDistributionTaskProjections(root);
  const coordinator = new DistributionExecutionCoordinator({
    ...config, sources, store: ledger, createFiles: factory,
    admitted: { rootId, admissions, readProjections, claimDistributionTask: (...args) => storage.claimDistributionTask(...args) },
  });
  const preparation = new DistributionPreparationService(coordinator);
  const confirmation = new DistributionConfirmationService(rootId, {
    admissions, readProjections, reconcile: () => reconciler.reconcile(), ticket: id => coordinator.ticket(id),
  });
  const settlement = new DistributionTaskSettlementService(rootId, {
    admissions, readProjections, receipts, journals, updateTask: (...args) => storage.update(...args),
  });
  const runner = new DistributionExecutionRunner(rootId, {
    admissions, readProjections, coordinator, settlement, recovery: { journals, coordinator },
  });
  const backend = new DistributionExecutionBackend(rootId, {
    available: () => true, admissions, preparation, confirmation, runner, views,
    onJobFailure: () => { console.warn(JSON.stringify({ level: 'warn', event: 'distribution-task-unsettled' })); },
  });
  return {
    backend, sources,
    async cancel(taskId: string): Promise<void> {
      const record = await admissions.readByTask(taskId);
      if (!record || record.phase !== 'projected' || record.plan.rootId !== rootId) throw new Error('NEEDS_RECOVERY');
      await runner.cancel(record.proposalId);
    },
    close: async () => {
      await backend.close();
      await runner.close();
      await confirmation.close();
      await settlement.close();
      await coordinator.close();
    },
  };
}

export type DistributionRuntime = Awaited<ReturnType<typeof openDistributionRuntime>>;
