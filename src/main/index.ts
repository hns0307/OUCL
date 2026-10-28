import { createDesktopFetch } from './network.js';
import { ModrinthClient } from '../services/resources/modrinth.js';
import { DesktopService } from '../services/desktop/service.js';
import { DesktopImages } from './desktop-images.js';
import { DESKTOP_CHANNELS } from '../shared/contracts/desktop.js';
import { handleDesktop } from '../ipc/desktop.js';
import { ResourceService } from '../services/resources/service.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../shared/contracts/download-preferences.js';
import type { DownloadPreferences } from '../shared/contracts/download-preferences.js';
import { RESOURCE_CHANNELS, ResourceContractError, isResourcePayload } from '../shared/contracts/resources.js';
import type { ResourceChannel, ResourcePayloads, ResourceData, ResourceDispatcher } from '../shared/contracts/resources.js';
import { handleResources } from '../ipc/resources.js';
import { ensureChildDirectory } from '../services/install/instance-files.js';
import { app, BrowserWindow, dialog, ipcMain, session, shell, net } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HANDSHAKE_CHANNEL } from '../shared/contracts/handshake.js';
import { isTrustedDocument, negotiateHandshake } from '../ipc/handshake.js';
import { MESSAGES } from '../shared/locales/messages.js';
import { ROOTS_CAPABILITY, ROOTS_CHOOSE_CHANNEL, ROOTS_LIST_CHANNEL } from '../shared/contracts/roots.js';
import { handleRoots } from '../ipc/roots.js';
import { RootError, RootService } from '../services/roots/service.js';
import { StorageClient } from '../services/workers/storage-client.js';
import { CATALOG_CAPABILITY, CATALOG_CHANNEL } from '../shared/contracts/catalog.js';
import { CatalogService } from '../services/catalog/service.js';
import { CatalogError, OfficialMetadataReader } from '../services/catalog/transport.js';
import { handleCatalog } from '../ipc/catalog.js';
import { InstallMetadataService } from '../services/catalog/install-metadata.js';
import { InstallerService } from '../services/install/installer.js';
import { InstallerAdapter } from '../ipc/installer-adapter.js';
import { handleInstances } from '../ipc/instances.js';
import { INSTANCE_CHANNELS, INSTANCES_CAPABILITY, TASKS_CAPABILITY, TASK_EVENT_CHANNEL, InstanceContractError } from '../shared/contracts/instances.js';
import type { InstanceDispatcher } from '../shared/contracts/instances.js';
import { ProfileService } from '../services/launch/profiles.js';
import { PROFILE_CAPABILITIES, PROFILE_CHANNELS, ProfileContractError } from '../shared/contracts/profiles.js';
import { handleProfiles } from '../ipc/profiles.js';
import { profileDispatcher } from '../ipc/profiles-adapter.js';
import { LaunchService } from '../services/launch/service.js';
import { JavaRuntimeService, isJavaMetadataUrl } from '../services/java/runtime.js';
import { GameAdapter } from '../ipc/game-adapter.js';
import { handleGame } from '../ipc/game.js';
import { GAME_CHANNELS, GAME_CAPABILITIES } from '../shared/contracts/game.js';
import { LOADER_CHANNELS, LOADERS_CAPABILITY, LoaderContractError } from '../shared/contracts/loaders.js';
import type { LoaderChannel, LoaderData, LoaderDispatcher, LoaderPayloads } from '../shared/contracts/loaders.js';
import { handleLoaders } from '../ipc/loaders.js';
import { LoaderMetadataClient, isOfficialLoaderMetadataUrl } from '../services/loaders/metadata.js';
import { LoaderMavenResolver } from '../services/loaders/maven.js';
import { LoaderInstallMetadataService } from '../services/loaders/install-metadata.js';
import { LoaderService } from '../services/loaders/service.js';
import { InstallerPreparationService } from '../services/loaders/installer-preparation.js';
import { InstallerArtifactResolver } from '../services/loaders/installer-artifact.js';
import { INSTANCES_V2_CAPABILITY, INSTANCES_V2_LIST_CHANNEL } from '../shared/contracts/instances-v2.js';
import { handleInstancesV2 } from '../ipc/instances-v2.js';
import { MOD_CHANNELS, MODS_CAPABILITY, ModContractError } from '../shared/contracts/mods.js';
import { handleMods, modDispatcher } from '../ipc/mods.js';
import { ModTaskService } from '../services/mods/tasks.js';
import { ModArchiveReader } from '../services/workers/mod-archive-reader.js';
import { InstalledLanguageReader } from '../services/mods/languages.js';
import { modInventoryContext } from '../services/mods/context.js';
import { InstalledJavaFacts } from '../services/mods/java-facts.js';
import { ModInventoryService } from '../services/mods/inventory.js';
import { ModInspectionService } from '../services/mods/inspection.js';
import { ModrinthModClient } from '../services/mods/modrinth.js';
import { ModLibraryReader } from '../services/mods/library.js';
import { ModDependencyResolver } from '../services/mods/resolver.js';
import { ModInstallPlanner } from '../services/mods/planner.js';
import { ModInstallPreparation } from '../services/mods/preparation.js';
import { ModTransactionService } from '../services/mods/transaction.js';
import { ModInstallTaskService } from '../services/mods/install-tasks.js';
import { ModPlanService } from '../services/mods/plans.js';
import { INSTANCE_FOLDER_CHANNEL, INSTANCE_FOLDERS_CAPABILITY, instanceFolderFailure, isInstanceFolderRequest } from '../shared/contracts/instance-folders.js';
import { InstanceFolderError, InstanceFolderService } from '../services/install/instance-folders.js';

const entryFile = path.join(__dirname, '../renderer/index.html');
const entryUrl = pathToFileURL(entryFile).href;
const sessions = new Map<number, string>();
let desktop: DesktopService | undefined; let desktopImages: DesktopImages | undefined;
let resources: ResourceService | undefined;
let downloadPreferences: Readonly<DownloadPreferences> = DEFAULT_DOWNLOAD_PREFERENCES;
let downloadPreferencesRevision = 0;
let storage: StorageClient | undefined;
let roots: RootService | undefined;
let catalog: CatalogService | undefined;
let installer: InstallerService | undefined;
let installerAdapter: InstallerAdapter | undefined;
let loaders: LoaderService | undefined;
let mods: ModTaskService | undefined;
let modPlanner: ModInstallPlanner | undefined;
let modPlans: ModPlanService | undefined;
let modInstalls: ModInstallTaskService | undefined;
let instanceFolders: InstanceFolderService | undefined;
let profiles: ProfileService | undefined;
let launches: LaunchService | undefined; let gameAdapter: GameAdapter | undefined; let closeWhenGamesExit = false;
const javaSelections = new Map<string, Promise<string | undefined>>();
const pendingSelections = new Set<string>();

/** Authorizes exact application document, current window and primary frame before any service access. */
function trustedSender(event: IpcMainInvokeEvent): boolean {
  if (event.sender.isDestroyed()) return false;
  return BrowserWindow.fromWebContents(event.sender) !== null && isTrustedDocument(event.senderFrame?.url ?? '', entryUrl,
    sessions.has(event.sender.id), event.senderFrame === event.sender.mainFrame);
}

/** Creates the sandboxed application window and binds subscriptions to its trusted document lifetime. */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180, height: 820, minWidth: 720, minHeight: 520, show: false,
    title: MESSAGES.appName, backgroundColor: '#f4f5f0', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    },
  });
  sessions.set(window.webContents.id, randomUUID());
  const id = window.webContents.id;
  window.webContents.once('destroyed', () => { sessions.delete(id); installerAdapter?.removeSender(id); gameAdapter?.removeSender(id); for (const key of javaSelections.keys()) if (key.startsWith(`${id}:`)) javaSelections.delete(key); });
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { installerAdapter?.removeSender(id); gameAdapter?.removeSender(id); } });
  window.on('close', event => { if (launches?.hasRunningGames()) { event.preventDefault(); closeWhenGamesExit = true; window.hide(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => { event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => { event.preventDefault(); });
  window.once('ready-to-show', () => { window.show(); });
  void window.loadFile(entryFile).catch(() => { app.exit(1); });
  return window;
}

app.setName(MESSAGES.appName);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
  session.defaultSession.setPermissionCheckHandler(() => false);
  const portableRoot = process.env.OUCL_PORTABLE_ROOT; delete process.env.OUCL_PORTABLE_ROOT;
  const portableGameDirectory = portableRoot ? path.join(portableRoot, 'OUCL.games') : undefined;
  try {
    const metadata = path.join(app.getPath('userData'), 'metadata'); await mkdir(metadata, { recursive: true });
    storage = await StorageClient.open(path.join(__dirname, '../workers/entry.cjs'), metadata);
    const networkFetch = createDesktopFetch(options => net.request(options));
    profiles = new ProfileService(storage); desktop = new DesktopService(storage); desktopImages = new DesktopImages(new ModrinthClient(networkFetch));
    roots = new RootService(storage, [app.getAppPath(), process.resourcesPath, app.getPath('userData')]);
    if (portableGameDirectory) {
      try { await roots.ensureDefault(portableGameDirectory); }
      catch { console.warn(JSON.stringify({ level: 'warn', event: 'default-root-unavailable', code: 'ROOT_UNAVAILABLE' })); }
    }
    const reader = new OfficialMetadataReader(networkFetch); catalog = new CatalogService(reader, storage);
    const vanillaMetadata = new InstallMetadataService(catalog, reader);
    const initialSettings = await storage.readSettings();
    downloadPreferences = initialSettings?.data.downloads ?? DEFAULT_DOWNLOAD_PREFERENCES;
    downloadPreferencesRevision = initialSettings?.revision ?? 0;
    const loaderClient = new LoaderMetadataClient(new OfficialMetadataReader(networkFetch, isOfficialLoaderMetadataUrl));
    const service: InstallerService = new InstallerService(storage, path.join(__dirname, '../workers/entry.cjs'), vanillaMetadata,
      new LoaderInstallMetadataService(vanillaMetadata, loaderClient, new LoaderMavenResolver(networkFetch)),
      new InstallerPreparationService(vanillaMetadata, loaderClient, new InstallerArtifactResolver(networkFetch)),
      async (major, consumerId, signal): Promise<string> => (await processorJava.ensure(major, consumerId, signal)).executable, () => downloadPreferences, networkFetch);
    const processorJava: JavaRuntimeService = new JavaRuntimeService(profiles, service, new OfficialMetadataReader(networkFetch, isJavaMetadataUrl));
    await service.initialize(); installer = service;
    instanceFolders = new InstanceFolderService(storage);
    loaders = new LoaderService(loaderClient, service);
    launches = new LaunchService(storage, profiles, service, undefined, undefined, processorJava); await launches.initialize();
    launches.onIdle(() => { if (closeWhenGamesExit) app.quit(); });
    const repository = storage;
    gameAdapter = new GameAdapter(launches, async () => { const root = await repository.readInstallation(); if (!root) throw new InstanceContractError('ROOT_UNAVAILABLE'); return root.data.rootId; });
    const resourceService = new ResourceService(storage, service, new ModrinthClient(networkFetch)); await resourceService.initialize(); resources = resourceService;
    // A damaged or newer Mod record must not disable existing launch/install capabilities.
    try {
      const scanner = new ModArchiveReader(path.join(__dirname, '../workers/entry.cjs'));
      const context = modInventoryContext(storage, new InstalledLanguageReader(scanner), new InstalledJavaFacts(profiles));
      const inventory = new ModInventoryService(context, scanner);
      const platform = new ModrinthModClient(networkFetch); const inspections = new ModInspectionService(context, inventory, platform);
      const modTasks = new ModTaskService(storage, inventory, inspections);
      modPlanner = new ModInstallPlanner(new ModLibraryReader(storage, scanner, platform), inspections, context, new ModDependencyResolver(platform));
      modPlans = new ModPlanService(storage, modPlanner);
      await modTasks.initialize(); mods = modTasks;
      const preparation = new ModInstallPreparation(storage, { planner: modPlanner, library: new ModLibraryReader(storage, scanner, platform),
        inspections, inventory, context, platform, transfer: service, scanner });
      const installations = new ModInstallTaskService(storage, preparation, new ModTransactionService(storage, { context, inventory, scanner }));
      await installations.initialize(); modInstalls = installations;
    } catch { console.warn(JSON.stringify({ level: 'warn', event: 'mods-unavailable', code: 'NEEDS_RECOVERY' })); }
    const resourceTasks = resources; const games = gameAdapter; const modTasks = mods; const installations = modInstalls;
    installerAdapter = new InstallerAdapter(service, storage, {
      get: async (root, id) => await games.get(root, id) ?? await resourceTasks.get(root, id) ?? await modTasks?.get(root, id) ?? await installations?.taskView(root, id),
      list: async root => [...await games.list(root), ...await resourceTasks.list(root), ...(modTasks ? await modTasks.list(root) : []), ...(installations ? await installations.list(root) : [])],
      cancel: async (root, id) => { if (installations && await installations.taskView(root, id)) {
        try { await installations.cancel(id); }
        catch (error) { throw new InstanceContractError(error instanceof ModContractError && error.code === 'CANCEL_TOO_LATE' ? 'CANCEL_TOO_LATE'
          : error instanceof ModContractError && error.code === 'NEEDS_RECOVERY' ? 'NEEDS_RECOVERY' : 'INVALID_TASK_STATE'); }
      }
        else if (modTasks && await modTasks.get(root, id)) await modTasks.cancel(root, id); else if (await resourceTasks.get(root, id)) await resourceTasks.cancel(root, id); else await games.cancel(root, id); },
    });
  } catch { /* Show a redacted unavailable state; never recreate a damaged repository. */ }
  ipcMain.handle(HANDSHAKE_CHANNEL, (event, input: unknown) => {
    return negotiateHandshake(input, trustedSender(event), sessions.get(event.sender.id) ?? '', randomUUID(), roots && catalog ? [ROOTS_CAPABILITY, CATALOG_CAPABILITY, ...(installerAdapter ? [INSTANCES_CAPABILITY, INSTANCES_V2_CAPABILITY, ...(instanceFolders ? [INSTANCE_FOLDERS_CAPABILITY] : []), TASKS_CAPABILITY, 'downloads.v1' as const] : []), ...(profiles ? PROFILE_CAPABILITIES : []), ...(desktop ? ['desktop.v1' as const] : []), ...(gameAdapter ? GAME_CAPABILITIES : []), ...(resources ? ['resources.v1' as const] : []), ...(loaders ? [LOADERS_CAPABILITY] : []), ...(mods && installerAdapter ? [MODS_CAPABILITY] : [])] : []);
  });
  ipcMain.handle(INSTANCE_FOLDER_CHANNEL, async (event, input: unknown) => {
    const traceId = randomUUID(); const fallback = typeof input === 'object' && input !== null && 'requestId' in input && typeof input.requestId === 'string' ? input.requestId : traceId;
    if (!trustedSender(event)) return instanceFolderFailure(fallback, 'INVALID_SENDER', traceId);
    if (!isInstanceFolderRequest(input)) return instanceFolderFailure(fallback, 'INVALID_ARGUMENT', traceId);
    try {
      if (!instanceFolders) throw new InstanceFolderError('ROOT_UNAVAILABLE');
      const directory = await instanceFolders.resolve(input.payload.instanceId.toLowerCase(), input.payload.folder);
      if (!trustedSender(event)) return instanceFolderFailure(input.requestId, 'INVALID_SENDER', traceId);
      if (await shell.openPath(directory)) return instanceFolderFailure(input.requestId, 'UNAVAILABLE', traceId);
      return { contractVersion: 1 as const, requestId: input.requestId, ok: true as const, data: { opened: true as const } };
    } catch (error) { return instanceFolderFailure(input.requestId, error instanceof InstanceFolderError ? error.code : 'UNAVAILABLE', traceId); }
  });
  for (const channel of MOD_CHANNELS) ipcMain.handle(channel, (event, input: unknown) => handleMods(channel, input, trustedSender(event), randomUUID(), async (selected, payload, requestId) => {
    if (!mods || !installerAdapter) throw new ModContractError('UNAVAILABLE');
    return modDispatcher(mods, modPlanner, modPlans, modInstalls)(selected, payload, requestId);
  }));
  ipcMain.handle(INSTANCES_V2_LIST_CHANNEL, (event, input: unknown) => handleInstancesV2(input, trustedSender(event), randomUUID(), async rootId => {
    const registered = await storage?.readInstallation();
    if (!installer || registered?.data.rootId !== rootId) throw new Error('UNAVAILABLE');
    return installer.listV2(rootId);
  }));
  for (const channel of LOADER_CHANNELS) ipcMain.handle(channel, (event, input: unknown) => handleLoaders(channel, input, trustedSender(event), randomUUID(), (async (selected: LoaderChannel, payload: LoaderPayloads[LoaderChannel], requestId: string) => {
    if (!loaders) throw new LoaderContractError('UNAVAILABLE');
    return loaders.dispatcher()(selected, payload, requestId) as Promise<LoaderData[typeof selected]>;
  }) as LoaderDispatcher));
  for (const channel of RESOURCE_CHANNELS) ipcMain.handle(channel, (event, input: unknown) => handleResources(channel, input, trustedSender(event), randomUUID(), (async (selected: ResourceChannel, payload: ResourcePayloads[ResourceChannel], requestId: string) => {
    if (!resources || !storage) throw new ResourceContractError('UNAVAILABLE');
    let data: ResourceData[typeof selected];
    if (selected === 'resources:search' && isResourcePayload(payload, 'resources:search')) data = await resources.client.search(payload);
    else if (selected === 'resources:versions' && isResourcePayload(payload, 'resources:versions')) data = await resources.client.versions(payload);
    else if (selected === 'resources:download' && isResourcePayload(payload, 'resources:download')) data = await resources.download(requestId, payload);
    else if (selected === 'resources:library') data = await resources.library();
    else if (selected === 'resources:open') {
      const registration = await storage.readInstallation(); if (!registration) throw new ResourceContractError('ROOT_UNAVAILABLE');
      const directory = await ensureChildDirectory(registration.data.dataDirectory, 'resource-library');
      if (!trustedSender(event)) throw new ResourceContractError('INVALID_SENDER');
      if (await shell.openPath(directory)) throw new ResourceContractError('UNAVAILABLE'); data = { opened: true };
    } else throw new ResourceContractError('INVALID_ARGUMENT');
    return data;
  }) as ResourceDispatcher));
  for (const channel of GAME_CHANNELS) ipcMain.handle(channel, (event, input: unknown) => handleGame(channel, input, trustedSender(event), randomUUID(), async (selected, payload, requestId) => {
    if (!gameAdapter) throw new InstanceContractError('UNAVAILABLE'); return gameAdapter.dispatcher(event.sender.id)(selected, payload, requestId);
  }));
  const iconSelections = new Map<number, Promise<string>>();
  for (const channel of DESKTOP_CHANNELS) ipcMain.handle(channel, (event, input: unknown) => handleDesktop(channel, input, trustedSender(event), randomUUID(), desktop, async () => {
    const pending = iconSelections.get(event.sender.id); if (pending) return pending;
    const job = (async () => {
      const owner = BrowserWindow.fromWebContents(event.sender); if (!owner || !trustedSender(event)) throw new Error('INVALID_SENDER');
      const selection = await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: MESSAGES.uiCustomIcon, extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (!trustedSender(event)) throw new Error('INVALID_SENDER'); if (selection.canceled || !selection.filePaths[0]) return '';
      return DesktopImages.local(selection.filePaths[0]);
    })(); iconSelections.set(event.sender.id, job); void job.finally(() => { iconSelections.delete(event.sender.id); }).catch(() => {}); return job;
  }, id => desktopImages?.icon(id) ?? Promise.resolve('')));
  for (const channel of PROFILE_CHANNELS) ipcMain.handle(channel, (event, input: unknown) => handleProfiles(channel, input, trustedSender(event), randomUUID(), async (selected, payload, requestId) => {
    if (!profiles || !storage) throw new ProfileContractError('UNAVAILABLE');
    const dispatch = profileDispatcher(profiles, storage, async id => {
      const key = `${event.sender.id}:${id}`; const pending = javaSelections.get(key); if (pending) return pending;
      if (pendingSelections.size >= 16) throw new ProfileContractError('UNAVAILABLE');
      while (javaSelections.size >= 64) { const stale = [...javaSelections.keys()].find(item => !pendingSelections.has(item)); if (!stale) throw new ProfileContractError('UNAVAILABLE'); javaSelections.delete(stale); }
      const selection = (async () => {
        const owner = BrowserWindow.fromWebContents(event.sender); if (!owner || !trustedSender(event)) throw new ProfileContractError('INVALID_SENDER');
        const result = await dialog.showOpenDialog(owner, { title: MESSAGES.javaChoose, properties: ['openFile'], filters: [{ name: MESSAGES.javaExecutableLabel, extensions: ['exe'] }] });
        if (!trustedSender(event)) throw new ProfileContractError('INVALID_SENDER'); return result.canceled ? undefined : result.filePaths[0];
      })();
      javaSelections.set(key, selection); pendingSelections.add(key); void selection.finally(() => { pendingSelections.delete(key); }).catch(() => {});
      return selection;
    }, (preferences, revision) => { if (revision >= downloadPreferencesRevision) { downloadPreferences = Object.freeze({ ...preferences }); downloadPreferencesRevision = revision; } });
    return dispatch(selected, payload, requestId);
  }));
  for (const channel of INSTANCE_CHANNELS) ipcMain.handle(channel, (event, input: unknown) => {
    const trusted = trustedSender(event);
    const unavailable: InstanceDispatcher = async () => { throw new InstanceContractError('UNAVAILABLE'); };
    const dispatch = trusted && installerAdapter ? installerAdapter.dispatcher(event.sender.id, message => {
      if (event.sender.isDestroyed()) throw new InstanceContractError('UNAVAILABLE'); event.sender.send(TASK_EVENT_CHANNEL, message);
    }) : unavailable;
    return handleInstances(channel, input, trusted, randomUUID(), dispatch);
  });
  ipcMain.handle(CATALOG_CHANNEL, (event, input: unknown) => handleCatalog(input, trustedSender(event), randomUUID(), async query => {
    if (!catalog) throw new CatalogError('CATALOG_UNAVAILABLE'); return catalog.list(query);
  }));
  ipcMain.handle(ROOTS_LIST_CHANNEL, (event, input: unknown) => handleRoots(input, trustedSender(event), randomUUID(), async () => {
    if (!roots) throw new RootError('ROOT_UNAVAILABLE'); return roots.list();
  }));
  ipcMain.handle(ROOTS_CHOOSE_CHANNEL, (event, input: unknown) => handleRoots(input, trustedSender(event), randomUUID(), async () => {
    if (!roots) throw new RootError('ROOT_UNAVAILABLE');
    if (portableGameDirectory) return roots.ensureDefault(portableGameDirectory);
    return roots.choose(async () => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new RootError('INVALID_SENDER');
      const result = await dialog.showOpenDialog(owner, { title: MESSAGES.storageTitle, properties: ['openDirectory', 'createDirectory'] });
      if (!trustedSender(event)) throw new RootError('INVALID_SENDER');
      return result.canceled ? undefined : result.filePaths[0];
    });
  }));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(() => { app.exit(1); });
app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { closeWhenGamesExit = false; if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let exiting = false;
let shutdownInProgress = false;
app.on('before-quit', event => {
  if (exiting) return;
  event.preventDefault(); if (shutdownInProgress) return; shutdownInProgress = true;
  void (async () => {
    if (launches && !await launches.close()) { closeWhenGamesExit = true; for (const window of BrowserWindow.getAllWindows()) window.hide(); shutdownInProgress = false; return; }
    installerAdapter?.close(); await modInstalls?.close(); await modPlans?.close(); await mods?.close(); await resources?.close(); await profiles?.close(); await installer?.close(); await storage?.close(); exiting = true; app.quit();
  })().catch(() => { app.exit(1); });
});

