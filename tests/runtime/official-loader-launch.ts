import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { OfficialMetadataReader } from '../../src/services/catalog/transport.js';
import { CatalogService } from '../../src/services/catalog/service.js';
import { InstallMetadataService } from '../../src/services/catalog/install-metadata.js';
import { InstallerService } from '../../src/services/install/installer.js';
import { LoaderMetadataClient, isOfficialLoaderMetadataUrl } from '../../src/services/loaders/metadata.js';
import { InstallerPreparationService } from '../../src/services/loaders/installer-preparation.js';
import { InstallerArtifactResolver } from '../../src/services/loaders/installer-artifact.js';
import { ProfileService } from '../../src/services/launch/profiles.js';
import { JavaRuntimeService } from '../../src/services/java/runtime.js';
import { LaunchService } from '../../src/services/launch/service.js';

const workspace = path.resolve(process.env.OUCL_LOADER_TEST_WORKSPACE ?? '');
if (path.dirname(workspace) !== path.resolve('.test-build') || !/^official-loader-[A-Za-z0-9]+$/.test(path.basename(workspace))) throw new Error('INVALID_TEST_WORKSPACE');
const kind = process.env.OUCL_LOADER_TEST_KIND ?? 'forge';
if (kind !== 'forge' && kind !== 'neoforge') throw new Error('INVALID_TEST_KIND');
const entry = path.resolve('dist/workers/entry.cjs'); const storage = await StorageClient.open(entry, path.join(workspace, 'metadata'));
const registration = await storage.readInstallation();
if (!registration || registration.data.dataDirectory !== path.join(workspace, 'games')) throw new Error('INVALID_TEST_ROOT');
const rootId = registration.data.rootId; const reader = new OfficialMetadataReader();
const vanilla = new InstallMetadataService(new CatalogService(reader, storage), reader);
const loaderClient = new LoaderMetadataClient(new OfficialMetadataReader(fetch, isOfficialLoaderMetadataUrl));
const profiles = new ProfileService(storage);
const installer = new InstallerService(storage, entry, vanilla, undefined,
  new InstallerPreparationService(vanilla, loaderClient, new InstallerArtifactResolver()));
const java = new JavaRuntimeService(profiles, installer); const launches = new LaunchService(storage, profiles, installer, undefined, undefined, java);
try {
  await installer.initialize(); await launches.initialize();
  const instance = (await installer.listV2(rootId)).find(item => item.loader.kind === kind && item.state === 'ready');
  if (!instance) throw new Error('READY_TEST_INSTANCE_MISSING');
  const saved = await profiles.list();
  const account = saved.accounts.find(item => item.gameName === 'OUCL_Verify')
    ?? await profiles.createOffline(randomUUID(), { displayName: 'OUCL loader verification', gameName: 'OUCL_Verify' });
  const accepted = await launches.launch(randomUUID(), { instanceId: instance.instanceId, accountId: account.accountId, expectedRevision: instance.revision });
  let previous = '';
  for (;;) {
    const task = await launches.task(rootId, accepted.taskId);
    if (!task) throw new Error('MISSING_LAUNCH_TASK');
    const marker = `${task.task.execution.state}:${task.session.snapshot.state}`;
    if (marker !== previous) { console.log(JSON.stringify({ event: 'launch-status', kind, state: task.task.execution.state, session: task.session.snapshot,
      errors: task.session.errors })); previous = marker; }
    if (['failed', 'needsRecovery', 'cancelled'].includes(task.task.execution.state)) throw new Error('OFFICIAL_LAUNCH_FAILED');
    if (task.session.snapshot.state === 'exited') {
      if (task.session.snapshot.exitCode !== 0) throw new Error('GAME_EXIT_NONZERO'); break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally {
  // An owned running game keeps this test process alive; never abandon it or steal its lease.
  if (await launches.close()) { await installer.close(); await profiles.close(); await storage.close(); }
}
