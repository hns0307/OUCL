import { net } from 'electron';
import { createDesktopFetch } from '../../src/main/network.js';
import { ObjectStore } from '../../src/services/objects/store.js';
import { HashPool } from '../../src/services/workers/hash-pool.js';
import { mkdir, mkdtemp, cp } from 'node:fs/promises';
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
import { LoaderInstallMetadataService } from '../../src/services/loaders/install-metadata.js';
import { LoaderMavenResolver } from '../../src/services/loaders/maven.js';
import { ProfileService } from '../../src/services/launch/profiles.js';
import { JavaRuntimeService, isJavaMetadataUrl } from '../../src/services/java/runtime.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../../src/shared/contracts/download-preferences.js';

const kind = process.env.OUCL_LOADER_TEST_KIND ?? 'forge';
if (!['fabric', 'quilt', 'forge', 'neoforge'].includes(kind)) throw new Error('INVALID_TEST_KIND');
const loaderKind = kind as 'fabric' | 'quilt' | 'forge' | 'neoforge';
if (process.env.OUCL_LOADER_NETWORK_TRACE === '1') {
  const request = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const source = { host: url.hostname, path: url.pathname, method: init?.method ?? 'GET' };
    try {
      const response = await request(input, init);
      console.log(JSON.stringify({ event: 'test-network-response', ...source, status: response.status,
        length: response.headers.get('content-length'), encoding: response.headers.get('content-encoding') }));
      return response;
    } catch (error) {
      const cause = error instanceof Error && error.cause && typeof error.cause === 'object' && 'code' in error.cause ? error.cause.code : null;
      console.log(JSON.stringify({ event: 'test-network-error', ...source, code: typeof cause === 'string' ? cause : 'NETWORK_FAILED' }));
      throw error;
    }
  };
}
const minecraftVersion = kind === 'neoforge' ? '1.21.1' : '1.20.1';
const loaderVersion = { fabric: '0.16.14', quilt: '0.29.2', forge: '47.4.28', neoforge: '21.1.265' }[loaderKind];
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
if (!reuse && process.env.OUCL_LOADER_TEST_CACHE) {
  const cache = path.resolve(process.env.OUCL_LOADER_TEST_CACHE);
  if (!cache.startsWith(path.resolve('.test-build') + path.sep) || !cache.endsWith(path.join('games', 'store', 'objects'))) throw new Error('INVALID_TEST_CACHE');
  await mkdir(path.join(games, 'store'), { recursive: true });
  await cp(cache, path.join(games, 'store', 'objects'), { recursive: true, dereference: false, force: false, errorOnExist: true });
  const hashes = new HashPool(entry); let objects: ObjectStore | undefined;
  try { objects = await ObjectStore.open(path.join(games, 'store'), storage, hashes); await objects.rebuildIndex(); }
  finally { await objects?.close(); await hashes.close(); }
}
const transport = process.env.OUCL_LOADER_TEST_SYSTEM_NETWORK === '1' ? createDesktopFetch(options => net.request(options)) : fetch;
let networkDisabled = false;
const request: typeof fetch = (input, init) => { if (networkDisabled) throw new Error('UNEXPECTED_NETWORK_ON_REOPEN'); return transport(input, init); };
const reader = new OfficialMetadataReader(request); const vanilla = new InstallMetadataService(new CatalogService(reader, storage), reader);
const catalog = new LoaderMetadataClient(new OfficialMetadataReader(request, isOfficialLoaderMetadataUrl));
const service: InstallerService = new InstallerService(storage, entry, vanilla, new LoaderInstallMetadataService(vanilla, catalog, new LoaderMavenResolver(request)),
  new InstallerPreparationService(vanilla, catalog, new InstallerArtifactResolver(request)),
  async (major, consumer, signal): Promise<string> => (await java.ensure(major, consumer, signal)).executable,
  () => ({ ...DEFAULT_DOWNLOAD_PREFERENCES, source: process.env.OUCL_LOADER_DOWNLOAD_SOURCE === 'bmclapi' ? 'bmclapi' : 'official' }), request);
const profiles = new ProfileService(storage); const java: JavaRuntimeService = new JavaRuntimeService(profiles, service, new OfficialMetadataReader(request, isJavaMetadataUrl));
console.log(JSON.stringify({ event: 'test-started', kind, minecraftVersion, loaderVersion, workspace }));
try {
  await service.initialize();
  if (process.env.OUCL_LOADER_TEST_REOPEN === '1') {
    const instance = (await service.listV2(rootId)).find(item => item.loader.kind === kind && item.state === 'ready');
    if (!instance) throw new Error('READY_TEST_INSTANCE_MISSING');
    networkDisabled = true;
    globalThis.fetch = async () => { throw new Error('UNEXPECTED_NETWORK_ON_REOPEN'); };
    await service.prepareLaunch(instance.instanceId, instance.revision, new AbortController().signal);
    console.log(JSON.stringify({ event: 'official-reopen-offline-verified', kind, instanceId: instance.instanceId, workspace }));
  } else {
  const accepted = await service.createLoader(randomUUID(), { rootId, mcVersionId: minecraftVersion, displayName: `Official ${kind} verification`,
    isolation: 'on', loader: { kind: loaderKind, version: loaderVersion } });
  let previous = ''; const deadline = Date.now() + 30 * 60 * 1000;
  for (;;) {
    const task = await service.task(rootId, accepted.taskId);
    const status = `${task.stage}:${Math.floor(task.task.execution.bytesDone / (32 * 1024 ** 2))}`;
    if (status !== previous) { console.log(JSON.stringify({ event: 'test-progress', stage: task.stage,
      state: task.task.execution.state, bytesDone: task.task.execution.bytesDone, bytesTotal: task.task.execution.bytesTotal })); previous = status; }
    if (['completed', 'failed', 'cancelled', 'needsRecovery'].includes(task.task.execution.state)) {
      if (task.task.execution.state !== 'completed' || !task.instance) throw new Error('OFFICIAL_INSTALL_FAILED');
      const record = await storage.readInstance(task.instance.instanceId);
      if (record?.data.metadata?.loader?.kind !== kind) throw new Error('LOADER_EVIDENCE_MISSING');
      if ((kind === 'forge' || kind === 'neoforge') && !('processors' in record.data.metadata.loader)) throw new Error('PROCESSOR_EVIDENCE_MISSING');
      await service.prepareLaunch(task.instance.instanceId, record.revision, new AbortController().signal);
      console.log(JSON.stringify({ event: 'official-install-verified', kind, instanceId: task.instance.instanceId, workspace })); break;
    }
    if (Date.now() > deadline) { await service.cancel(rootId, accepted.taskId); throw new Error('OFFICIAL_INSTALL_TIMEOUT'); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  }
} finally { await service.close(); await storage.close(); }
