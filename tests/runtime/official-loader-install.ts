import { mkdir, mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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

const kind = process.env.OUCL_LOADER_TEST_KIND ?? 'forge';
if (kind !== 'forge' && kind !== 'neoforge') throw new Error('INVALID_TEST_KIND');
const minecraftVersion = kind === 'forge' ? '1.20.1' : '1.21.1';
const loaderVersion = kind === 'forge' ? '47.4.28' : '21.1.265';
const reuse = process.env.OUCL_LOADER_TEST_WORKSPACE;
const workspace = reuse ? path.resolve(reuse) : await mkdtemp(path.resolve('.test-build/official-loader-'));
if (path.dirname(workspace) !== path.resolve('.test-build') || !/^official-loader-[A-Za-z0-9]+$/.test(path.basename(workspace))) throw new Error('INVALID_TEST_WORKSPACE');
const metadataDirectory = path.join(workspace, 'metadata'); const games = path.join(workspace, 'games');
if (!reuse) { await mkdir(metadataDirectory); await mkdir(games); }
const entry = path.resolve('dist/workers/entry.cjs'); const storage = await StorageClient.open(entry, metadataDirectory);
const registration = await storage.readInstallation();
if (registration && registration.data.dataDirectory !== games) throw new Error('INVALID_TEST_REGISTRATION');
const rootId = registration?.data.rootId ?? randomUUID();
if (!registration) await storage.createInstallation({ rootId, dataDirectory: games });
const reader = new OfficialMetadataReader(); const vanilla = new InstallMetadataService(new CatalogService(reader, storage), reader);
const catalog = new LoaderMetadataClient(new OfficialMetadataReader(fetch, isOfficialLoaderMetadataUrl));
const service: InstallerService = new InstallerService(storage, entry, vanilla, undefined,
  new InstallerPreparationService(vanilla, catalog, new InstallerArtifactResolver()),
  async (major, consumer, signal): Promise<string> => (await java.ensure(major, consumer, signal)).executable);
const profiles = new ProfileService(storage); const java: JavaRuntimeService = new JavaRuntimeService(profiles, service);
console.log(JSON.stringify({ event: 'test-started', kind, minecraftVersion, loaderVersion, workspace }));
try {
  await service.initialize();
  const accepted = await service.createLoader(randomUUID(), { rootId, mcVersionId: minecraftVersion, displayName: `Official ${kind} verification`,
    isolation: 'on', loader: { kind, version: loaderVersion } });
  let previous = ''; const deadline = Date.now() + 30 * 60 * 1000;
  for (;;) {
    const task = await service.task(rootId, accepted.taskId);
    const status = `${task.stage}:${Math.floor(task.task.execution.bytesDone / (32 * 1024 ** 2))}`;
    if (status !== previous) { console.log(JSON.stringify({ event: 'test-progress', stage: task.stage,
      state: task.task.execution.state, bytesDone: task.task.execution.bytesDone, bytesTotal: task.task.execution.bytesTotal })); previous = status; }
    if (['completed', 'failed', 'cancelled', 'needsRecovery'].includes(task.task.execution.state)) {
      if (task.task.execution.state !== 'completed' || !task.instance) throw new Error('OFFICIAL_INSTALL_FAILED');
      const record = await storage.readInstance(task.instance.instanceId);
      if (record?.data.metadata?.loader?.kind !== kind || !('processors' in record.data.metadata.loader)) throw new Error('PROCESSOR_EVIDENCE_MISSING');
      await service.prepareLaunch(task.instance.instanceId, record.revision, new AbortController().signal);
      console.log(JSON.stringify({ event: 'official-install-verified', kind, instanceId: task.instance.instanceId, workspace })); break;
    }
    if (Date.now() > deadline) { await service.cancel(rootId, accepted.taskId); throw new Error('OFFICIAL_INSTALL_TIMEOUT'); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally { await service.close(); await storage.close(); }
