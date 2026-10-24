import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
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

const entryFile = path.join(__dirname, '../renderer/index.html');
const entryUrl = pathToFileURL(entryFile).href;
const sessions = new Map<number, string>();
let storage: StorageClient | undefined;
let roots: RootService | undefined;

/** Authorizes exact application document, current window and primary frame before any service access. */
function trustedSender(event: IpcMainInvokeEvent): boolean {
  return BrowserWindow.fromWebContents(event.sender) !== null && isTrustedDocument(event.senderFrame?.url ?? '', entryUrl,
    sessions.has(event.sender.id), event.senderFrame === event.sender.mainFrame);
}

/** Creates the sandboxed empty application window; no business services are wired. */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1040, height: 720, minWidth: 720, minHeight: 520, show: false,
    title: MESSAGES.appName, backgroundColor: '#f4f5f0', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    },
  });
  sessions.set(window.webContents.id, randomUUID());
  const id = window.webContents.id;
  window.webContents.once('destroyed', () => { sessions.delete(id); });
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
    roots = new RootService(storage, [app.getAppPath(), process.resourcesPath, app.getPath('userData')]);
  } catch { /* Show a redacted unavailable state; never recreate a damaged repository. */ }
  ipcMain.handle(HANDSHAKE_CHANNEL, (event, input: unknown) => {
    return negotiateHandshake(input, trustedSender(event), sessions.get(event.sender.id) ?? '', randomUUID(), roots ? [ROOTS_CAPABILITY] : []);
  });
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
app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let exiting = false;
app.on('before-quit', event => {
  if (exiting) return;
  event.preventDefault(); exiting = true;
  void storage?.close().catch(() => {}).finally(() => { app.quit(); });
  if (!storage) app.quit();
});
