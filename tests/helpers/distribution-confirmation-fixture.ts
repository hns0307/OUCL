import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DistributionConfirmationService } from '../../src/services/distribution/confirmation.js';
import { DistributionAdmissionReconciler } from '../../src/services/distribution/reconciliation.js';
import type { DistributionReconciliationPorts } from '../../src/services/distribution/reconciliation.js';
import { RecordStore } from '../../src/services/storage/records.js';
import { parseInstallation } from '../../src/services/storage/installation.js';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { localDomainFixture } from './distribution-local-domain-fixture.js';

type ConfirmationPorts = ConstructorParameters<typeof DistributionConfirmationService>[1];

/** Real JAR worker, signed ticket and two SQLite owners; publisher/platform/permission inputs remain synthetic. */
export async function confirmationFixture() {
  const domain = await localDomainFixture();
  try {
    const artifact = await domain.artifact(); const plan = domain.plan([domain.add(artifact)]); await domain.accept(plan);
    const coordinator = await domain.coordinator(plan);
    try {
      const proposal = await coordinator.prepare(plan.txId, { rootId: plan.rootId, instanceId: plan.instanceId,
        sourceId: plan.sourceId, packageId: plan.packageId, packageVersion: plan.packageVersion });
      const directory = path.join(domain.base, 'task-metadata'); await mkdir(directory);
      const records = await RecordStore.open(directory);
      try {
        await records.recover(); await records.write('installation', 0, { rootId: plan.rootId, dataDirectory: directory }, parseInstallation);
      } finally { await records.close(); }
      const client = await StorageClient.open(new URL('../../src/services/workers/entry.js', import.meta.url), directory);
      let tickets = 0;
      const admissions = domain.store.admissions;
      const reconciliationPorts: DistributionReconciliationPorts = { admissions,
        readProjections: root => client.readDistributionTaskProjections(root),
        project: (root, proposalId, digest, taskId) => client.projectDistributionTask(root, proposalId, digest, taskId) };
      const reconciler = new DistributionAdmissionReconciler(plan.rootId, reconciliationPorts);
      const allReconciliers = new Set([reconciler]); const services = new Set<DistributionConfirmationService>();
      const ports: ConfirmationPorts = { admissions,
        ticket: async id => { tickets++; return coordinator.ticket(id); },
        reconcile: () => reconciler.reconcile(), readProjections: root => client.readDistributionTaskProjections(root) };
      function service(overrides: Partial<ConfirmationPorts> = {}, rootId = plan.rootId) {
        const value = new DistributionConfirmationService(rootId, { ...ports, ...overrides }); services.add(value); return value;
      }
      function reconciliation(overrides: Partial<DistributionReconciliationPorts>) {
        const value = new DistributionAdmissionReconciler(plan.rootId, { ...reconciliationPorts, ...overrides }); allReconciliers.add(value); return value;
      }
      return { domain, artifact, plan, proposal, coordinator, client, ports, admissions, reconciliationPorts, service, reconciliation,
        counts: () => ({ tickets }), input: { proposalId: plan.txId, instanceRevision: plan.instanceRevision, sequence: plan.sequence },
        close: async () => {
          await Promise.all([...services].map(value => value.close())); await Promise.all([...allReconciliers].map(value => value.close()));
          await client.close(); await coordinator.close(); await domain.close();
        } };
    } catch (error) { await coordinator.close(); throw error; }
  } catch (error) { await domain.close(); throw error; }
}
