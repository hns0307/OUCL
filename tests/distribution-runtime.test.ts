import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { canonicalDistributionReleasePayload } from '../src/core/distribution/release.js';
import { DistributionExecutionAdapter } from '../src/ipc/distribution-execution.js';
import { openDistributionRuntime } from '../src/main/distribution-runtime.js';
import type { DistributionRuntime } from '../src/main/distribution-runtime.js';
import { DistributionAdmissionReconciler } from '../src/services/distribution/reconciliation.js';
import { DistributionTaskViewProvider } from '../src/services/distribution/task-views.js';
import { parseInstallation } from '../src/services/storage/installation.js';
import { RecordStore } from '../src/services/storage/records.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import type { DistributionExecutionChannel, DistributionExecutionPayloads } from '../src/shared/contracts/distribution-execution.js';
import { localDomainFixture, ROOT } from './helpers/distribution-local-domain-fixture.js';

test('the main runtime factory opens with reviewed fixture ports and completes a protected distribution task', {
  skip: process.platform !== 'win32' || process.arch !== 'x64', timeout: 30000,
}, async () => {
  const fixture = await localDomainFixture();
  let storage: StorageClient | undefined;
  let reconciler: DistributionAdmissionReconciler | undefined;
  let views: DistributionTaskViewProvider | undefined;
  let runtime: DistributionRuntime | undefined;
  let adapter: DistributionExecutionAdapter | undefined;
  try {
    const artifact = await fixture.artifact();
    const plan = fixture.plan([fixture.add(artifact)]);
    const { rootId, instanceId, sourceId, packageId, packageVersion, sequence, manifestSha256, manifest } = plan;
    const binding = { rootId, instanceId, sourceId, packageId, packageVersion };
    const directory = path.join(fixture.base, 'runtime-task-owner');
    await mkdir(directory);
    const records = await RecordStore.open(directory);
    try {
      await records.recover();
      await records.write('installation', 0, { rootId, dataDirectory: directory }, parseInstallation);
    } finally { await records.close(); }
    const client = storage = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), directory);
    const ledger = fixture.store;
    const reconciliation = reconciler = new DistributionAdmissionReconciler(rootId, {
      admissions: ledger.admissions,
      readProjections: root => client.readDistributionTaskProjections(root),
      project: (...args) => client.projectDistributionTask(...args),
    });
    const provider = views = new DistributionTaskViewProvider(rootId, {
      storage: client, admissions: ledger.admissions, ready: async () => { await reconciliation.reconcile(); },
    });
    await fixture.transaction();
    const keys = generateKeyPairSync('ed25519');
    const keyId = 'runtime-fixture';
    const now = Date.now();
    const payload = { releaseFormatVersion: 2 as const, sourceId, packageId, packageVersion, sequence,
      issuedAt: now - 1000, expiresAt: now + 3600000, manifestSha256, manifest };
    const signature = { algorithm: 'ed25519', keyId,
      value: sign(null, Buffer.from(canonicalDistributionReleasePayload(payload)), keys.privateKey).toString('base64') };
    let fetched = 0;
    const config = {
      sources: [{ sourceId, manifestOrigin: 'https://synthetic.invalid', manifestPathPrefix: '/releases/',
        keys: [{ keyId, spki: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] }],
      fetcher: (async () => { fetched++; return new Response(JSON.stringify({ payload, signature })); }) as typeof fetch,
      readTarget: async () => ({ rootId, instanceId, revision: plan.instanceRevision, gameDir: fixture.gameDir, environment: manifest.target }),
      isIdle: async () => true,
      validate: fixture.domain.validate.bind(fixture.domain),
      artifact: fixture.domain.artifact.bind(fixture.domain),
    };
    const native = path.join(ROOT, 'native-build', 'native');
    await assert.rejects(openDistributionRuntime(rootId, client, ledger, reconciliation, provider, native, { ...config, sources: [] }), /SOURCE_UNAVAILABLE/);
    runtime = await openDistributionRuntime(rootId, client, ledger, reconciliation, provider, native, config);
    assert.equal(fetched, 0);
    const transport = adapter = new DistributionExecutionAdapter(runtime.backend.document());
    const dispatch = <C extends DistributionExecutionChannel>(channel: C, data: DistributionExecutionPayloads[C], requestId = randomUUID()) =>
      transport.handle(channel, { contractVersion: 1, requestId, payload: data }, () => true, randomUUID());
    const proposalId = randomUUID();
    assert.ok((await dispatch('distribution:prepareExecution', binding, proposalId)).ok);
    let ready;
    for (let attempt = 0; attempt < 200; attempt++) {
      const reply = await dispatch('distribution:executionPreparation', { prepareRequestId: proposalId });
      assert.ok(reply.ok && 'state' in reply.data);
      if (reply.data.state === 'ready') { ready = reply.data.proposal; break; }
      assert.equal(reply.data.state, 'pending');
      await setTimeout(20);
    }
    assert.ok(ready);
    const accepted = await dispatch('distribution:confirmExecution', {
      proposalId, sequence: ready.sequence, instanceRevision: ready.instanceRevision,
    });
    assert.ok(accepted.ok && 'taskId' in accepted.data);
    const { taskId } = accepted.data;
    for (let attempt = 0; attempt < 300; attempt++) {
      if ((await client.get(rootId, taskId))?.execution.state === 'completed') break;
      await setTimeout(20);
    }
    assert.equal((await provider.get(taskId))?.snapshot.state, 'completed');
    assert.deepEqual(await readFile(path.join(fixture.gameDir, 'mods', 'managed.jar')), artifact.bytes);
    assert.equal((await ledger.journals.read(proposalId))?.data.phase, 'committed');
    assert.equal(fetched, 1);
  } finally {
    await adapter?.close();
    await runtime?.close();
    await views?.close();
    await reconciler?.close();
    await storage?.close();
    await fixture.close();
  }
});
