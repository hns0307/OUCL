import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDistributionPayload } from '../../src/core/distribution/manifest.js';
import { canonicalDistributionReleasePayload } from '../../src/core/distribution/release.js';
import type { AdmissionIntent } from '../../src/services/distribution/admission-record.js';
import type { DistributionReconciliationPorts } from '../../src/services/distribution/reconciliation.js';
import { PinnedReleaseSource } from '../../src/services/distribution/release-source.js';
import { DistributionStore } from '../../src/services/distribution/store.js';
import { transactionDigest } from '../../src/services/distribution/transaction-record.js';
import { RecordStore } from '../../src/services/storage/records.js';
import { parseInstallation } from '../../src/services/storage/installation.js';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { createHash } from 'node:crypto';

/** Private synthetic authority and two real SQLite owners; no remote request or game mutation. */
export async function reconciliationFixture() {
  const base = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/reconciliation-20261117-b');
  await mkdir(base, { recursive: true }); const directory = await mkdtemp(path.join(base, 'case-'));
  const rootId = randomUUID(); const recordsDirectory = path.join(directory, 'records');
  await mkdir(recordsDirectory); await mkdir(path.join(directory, 'authority'));
  const records = await RecordStore.open(recordsDirectory);
  try {
    await records.recover(); await records.write('installation', 0, { rootId, dataDirectory: recordsDirectory }, parseInstallation);
  } finally { await records.close(); }
  const client = await StorageClient.open(new URL('../../src/services/workers/entry.js', import.meta.url), recordsDirectory);
  const store = await DistributionStore.open(path.join(directory, 'authority'));
  try {
    const manifest = { formatVersion: 1 as const, packageId: 'synthetic-club', packageVersion: '1',
      target: { minecraft: '1.20.1', javaMajor: 17 as const, loader: 'vanilla' as const, loaderVersion: null }, operations: [] };
    const payload = { releaseFormatVersion: 2 as const, sourceId: 'synthetic-reconciliation', packageId: manifest.packageId,
      packageVersion: '1', sequence: 1, issuedAt: 1000, expiresAt: 3000,
      manifestSha256: createHash('sha256').update(canonicalDistributionPayload(manifest)).digest('hex'), manifest };
    const pair = generateKeyPairSync('ed25519');
    const envelope = { payload, signature: { algorithm: 'ed25519' as const, keyId: 'temporary-key',
      value: sign(null, Buffer.from(canonicalDistributionReleasePayload(payload)), pair.privateKey).toString('base64') } };
    const source = { sourceId: payload.sourceId, manifestOrigin: 'https://synthetic.invalid', manifestPathPrefix: '/releases/',
      keys: [{ keyId: 'temporary-key', spki: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
    const accepted = await new PinnedReleaseSource(source, store, { now: () => 2000,
      fetcher: async () => new Response(JSON.stringify(envelope)) }).resolve({ packageId: manifest.packageId, packageVersion: '1', target: manifest.target });
    await store.saveAcceptedRelease(accepted);
    const intent = (owner = rootId): AdmissionIntent => {
      const proposalId = randomUUID();
      return { confirmRequestId: randomUUID(), proposalId, releaseSha256: accepted.releaseSha256,
        gameIdentity: { dev: '1', ino: '2' }, previewFingerprint: 'a'.repeat(64),
        plan: { formatVersion: 1, txId: proposalId, rootId: owner, instanceId: randomUUID(), instanceRevision: 1,
          sourceId: payload.sourceId, packageId: manifest.packageId, packageVersion: '1', sequence: 1,
          manifestSha256: payload.manifestSha256, manifest } };
    };
    const ports: DistributionReconciliationPorts = { admissions: store.admissions,
      readProjections: owner => client.readDistributionTaskProjections(owner),
      project: (owner, proposal, digest, task) => client.projectDistributionTask(owner, proposal, digest, task) };
    return { rootId, directory, store, client, intent, ports, digest: transactionDigest,
      close: async () => { await client.close(); await store.close(); } };
  } catch (error) { await client.close(); await store.close(); throw error; }
}
