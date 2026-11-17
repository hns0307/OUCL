import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDistributionReleasePayload } from '../../src/core/distribution/release.js';
import { DistributionExecutionCoordinator } from '../../src/services/distribution/execution.js';
import type { DistributionExecutionOptions } from '../../src/services/distribution/execution.js';
import { DistributionConfirmationService } from '../../src/services/distribution/confirmation.js';
import { DistributionAdmissionReconciler } from '../../src/services/distribution/reconciliation.js';
import { loadWindowsDistributionFiles } from '../../src/services/distribution/native-files.js';
import { RecordStore } from '../../src/services/storage/records.js';
import { parseInstallation } from '../../src/services/storage/installation.js';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { localDomainFixture, ROOT } from './distribution-local-domain-fixture.js';

type AdmittedPorts = NonNullable<DistributionExecutionOptions['admitted']>;

/** Actual SQLite/native/JAR composition. Publisher, redistribution policy and platform metadata are synthetic. */
export async function admittedExecutionFixture(overrides: Partial<AdmittedPorts> = {}) {
  const f = await localDomainFixture();
  try {
    const artifact = await f.artifact(); const plan = f.plan([f.add(artifact)]);
    let now = 1794873600000;
    const pair = generateKeyPairSync('ed25519');
    const source = { sourceId: plan.sourceId, manifestOrigin: 'https://synthetic.invalid', manifestPathPrefix: '/releases/',
      keys: [{ keyId: 'synthetic-j-key', spki: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
    const payload = { releaseFormatVersion: 2 as const, sourceId: plan.sourceId, packageId: plan.packageId, packageVersion: plan.packageVersion,
      sequence: plan.sequence, issuedAt: now - 1000, expiresAt: now + 3600000, manifestSha256: plan.manifestSha256, manifest: plan.manifest };
    const envelope = { payload, signature: { algorithm: 'ed25519', keyId: source.keys[0]!.keyId,
      value: sign(null, Buffer.from(canonicalDistributionReleasePayload(payload)), pair.privateKey).toString('base64') } };
    const directory = path.join(f.base, 'task-owner'); await mkdir(directory);
    const records = await RecordStore.open(directory);
    try { await records.recover(); await records.write('installation', 0, { rootId: plan.rootId, dataDirectory: directory }, parseInstallation); }
    finally { await records.close(); }
    const client = await StorageClient.open(new URL('../../src/services/workers/entry.js', import.meta.url), directory);
    try {
      await f.transaction(); // Reuses the fixture's process-owned protected helper build, without committing its transaction.
      const factory = await loadWindowsDistributionFiles(path.join(ROOT, 'native-build', 'native'));
      let claims = 0; let artifacts = 0; let adapters = 0;
      let loseClaimAck = false; let idle = true;
      let failedJournalRead = false;
      let receiptGate: { enter(): void; settled: Promise<void> } | undefined;
      const executionStore: DistributionExecutionOptions['store'] = {
        read: scope => f.store.read(scope), compareAndSet: (...args) => f.store.compareAndSet(...args),
        saveAcceptedRelease: value => f.store.saveAcceptedRelease(value), readAcceptedRelease: scope => f.store.readAcceptedRelease(scope),
        canRecover: (...args) => f.store.canRecover(...args),
        journals: { read: async id => { if (failedJournalRead) throw new Error('SYNTHETIC_TERMINAL_METADATA_READ_FAILURE'); return f.store.journals.read(id); },
          write: (...args) => f.store.journals.write(...args) },
        receipts: { read: id => f.store.receipts.read(id), commit: async (...args) => {
          const value = await f.store.receipts.commit(...args); const gate = receiptGate; receiptGate = undefined;
          if (gate) { gate.enter(); await gate.settled; } return value;
        } },
      };
      const admitted: AdmittedPorts = { rootId: plan.rootId, admissions: f.store.admissions,
        readProjections: root => client.readDistributionTaskProjections(root),
        claimDistributionTask: async (...args) => { claims++; const value = await client.claimDistributionTask(...args);
          if (loseClaimAck) throw new Error('SYNTHETIC_COMMITTED_CLAIM_ACK_LOSS'); return value; }, ...overrides };
      const coordinator = new DistributionExecutionCoordinator({ sources: [source], readSources: () => [source], store: executionStore,
        now: () => now, fetcher: async () => new Response(JSON.stringify(envelope)), admitted,
        readTarget: async () => ({ rootId: plan.rootId, instanceId: plan.instanceId, revision: 1, gameDir: f.gameDir, environment: plan.manifest.target }),
        isIdle: async () => idle, validate: (input, signal) => f.domain.validate(input, signal),
        artifact: (input, index, signal) => { artifacts++; return f.domain.artifact(input, index, signal); },
        createFiles: (gameDir, txId, proof) => { adapters++; return factory(gameDir, txId, proof); } });
      try {
        await coordinator.prepare(plan.txId, { rootId: plan.rootId, instanceId: plan.instanceId, sourceId: plan.sourceId,
          packageId: plan.packageId, packageVersion: plan.packageVersion });
        const reconciler = new DistributionAdmissionReconciler(plan.rootId, { admissions: f.store.admissions,
          readProjections: root => client.readDistributionTaskProjections(root),
          project: (root, proposal, digest, task) => client.projectDistributionTask(root, proposal, digest, task) });
        const confirmation = new DistributionConfirmationService(plan.rootId, { admissions: f.store.admissions,
          ticket: id => coordinator.ticket(id), reconcile: () => reconciler.reconcile(), readProjections: root => client.readDistributionTaskProjections(root) });
        const accepted = await confirmation.confirm(randomUUID(), { proposalId: plan.txId, instanceRevision: 1, sequence: plan.sequence });
        return { f, plan, artifact, accepted, coordinator, client,
          counts: () => ({ claims, artifacts, adapters }), loseClaimAck: () => { loseClaimAck = true; },
          setIdle: (value: boolean) => { idle = value; },
          failTerminalJournalReads: () => { failedJournalRead = true; },
          holdReceiptCommit: () => {
            let enter!: () => void; let release!: () => void;
            const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
            receiptGate = { enter, settled }; return { entered, release };
          },
          revoke: () => { source.keys[0]!.revoked = true; }, advance: (ms: number) => { now += ms; f.advance(ms); },
          close: async () => { await confirmation.close(); await reconciler.close(); await coordinator.close(); await client.close(); await f.close(); } };
      } catch (error) { await coordinator.close(); throw error; }
    } catch (error) { await client.close(); throw error; }
  } catch (error) { await f.close(); throw error; }
}
