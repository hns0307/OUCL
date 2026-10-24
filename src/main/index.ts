import { app, BrowserWindow, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HANDSHAKE_CHANNEL } from '../shared/contracts/handshake.js';
import { isTrustedDocument, negotiateHandshake } from '../ipc/handshake.js';
import { MESSAGES } from '../shared/locales/messages.js';

const entryFile = path.join(__dirname, '../renderer/index.html');
const entryUrl = pathToFileURL(entryFile).href;
const sessions = new Map<number, string>();

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
void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
  session.defaultSession.setPermissionCheckHandler(() => false);
  ipcMain.handle(HANDSHAKE_CHANNEL, (event, input: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const trusted = owner !== null && isTrustedDocument(event.senderFrame?.url ?? '', entryUrl,
      sessions.has(event.sender.id), event.senderFrame === event.sender.mainFrame);
    return negotiateHandshake(input, trusted, sessions.get(event.sender.id) ?? '', randomUUID());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(() => { app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
