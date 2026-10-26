import { ResourceService } from '../services/resources/service.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../shared/contracts/download-preferences.js';
import type { DownloadPreferences } from '../shared/contracts/download-preferences.js';
import { RESOURCE_CHANNELS, ResourceContractError, isResourcePayload } from '../shared/contracts/resources.js';
import type { ResourceChannel, ResourcePayloads, ResourceData, ResourceDispatcher } from '../shared/contracts/resources.js';
import { handleResources } from '../ipc/resources.js';
import { ensureChildDirectory } from '../services/install/instance-files.js';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
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
import { JavaRuntimeService } from '../services/java/runtime.js';
import { GameAdapter } from '../ipc/game-adapter.js';
import { handleGame } from '../ipc/game.js';
import { GAME_CHANNELS, GAME_CAPABILITIES } from '../shared/contracts/game.js';

const entryFile = path.join(__dirname, '../renderer/index.html');
const entryUrl = pathToFileURL(entryFile).href;
const sessions = new Map<number, string>();
let resources: ResourceService | undefined;
let downloadPreferences: Readonly<DownloadPreferences> = DEFAULT_DOWNLOAD_PREFERENCES;
let downloadPreferencesRevision = 0;
let storage: StorageClient | undefined;
let roots: RootService | undefined;
let catalog: CatalogService | undefined;
let installer: InstallerService | undefined;
let installerAdapter: InstallerAdapter | undefined;
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
  try {
    const metadata = path.join(app.getPath('userData'), 'metadata'); await mkdir(metadata, { recursive: true });
    storage = await StorageClient.open(path.join(__dirname, '../workers/entry.cjs'), metadata);
    profiles = new ProfileService(storage);
    roots = new RootService(storage, [app.getAppPath(), process.resourcesPath, app.getPath('userData')]);
    const reader = new OfficialMetadataReader(); catalog = new CatalogService(reader, storage);
    const initialSettings = await storage.readSettings();
    downloadPreferences = initialSettings?.data.downloads ?? DEFAULT_DOWNLOAD_PREFERENCES;
    downloadPreferencesRevision = initialSettings?.revision ?? 0;
    const service = new InstallerService(storage, path.join(__dirname, '../workers/entry.cjs'), new InstallMetadataService(catalog, reader), () => downloadPreferences);
    await service.initialize(); installer = service;
    launches = new LaunchService(storage, profiles, service, undefined, undefined, new JavaRuntimeService(profiles, service)); await launches.initialize();
    launches.onIdle(() => { if (closeWhenGamesExit) app.quit(); });
    const repository = storage;
    gameAdapter = new GameAdapter(launches, async () => { const root = await repository.readInstallation(); if (!root) throw new InstanceContractError('ROOT_UNAVAILABLE'); return root.data.rootId; });
    const resourceService = new ResourceService(storage, service); await resourceService.initialize(); resources = resourceService;
    const resourceTasks = resources; const games = gameAdapter;
    installerAdapter = new InstallerAdapter(service, storage, {
      get: async (root, id) => await games.get(root, id) ?? await resourceTasks.get(root, id),
      list: async root => [...await games.list(root), ...await resourceTasks.list(root)],
      cancel: async (root, id) => { if (await resourceTasks.get(root, id)) await resourceTasks.cancel(root, id); else await games.cancel(root, id); },
    });
  } catch { /* Show a redacted unavailable state; never recreate a damaged repository. */ }
  ipcMain.handle(HANDSHAKE_CHANNEL, (event, input: unknown) => {
    return negotiateHandshake(input, trustedSender(event), sessions.get(event.sender.id) ?? '', randomUUID(), roots && catalog ? [ROOTS_CAPABILITY, CATALOG_CAPABILITY, ...(installerAdapter ? [INSTANCES_CAPABILITY, TASKS_CAPABILITY, 'downloads.v1' as const] : []), ...(profiles ? PROFILE_CAPABILITIES : []), ...(gameAdapter ? GAME_CAPABILITIES : []), ...(resources ? ['resources.v1' as const] : [])] : []);
  });
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
    installerAdapter?.close(); await resources?.close(); await profiles?.close(); await installer?.close(); await storage?.close(); exiting = true; app.quit();
  })().catch(() => { app.exit(1); });
});
