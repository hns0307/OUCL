import { randomUUID } from 'node:crypto';
import { dialog, ipcMain, nativeImage, session, shell, WebContentsView, BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent, Session } from 'electron';
import { handleWebExtensions } from '../ipc/web-extensions.js';
import type { WebEndpoint } from '../ipc/web-extensions.js';
import { MAX_WEB_TABS, WEB_EXTENSIONS_CHANNEL, webFailure } from '../shared/contracts/web-extensions.js';
import type { WebAction, WebBounds, WebSnapshot, WebTab } from '../shared/contracts/web-extensions.js';
import { ensureChildDirectory } from '../services/install/instance-files.js';
import type { WebAdapter } from '../services/web/adapters.js';
import { WebAdapterRegistry } from '../services/web/adapters.js';
import { WebArchiveReader } from '../services/web/archive-reader.js';
import { WebBookmarks } from '../services/web/bookmarks.js';
import { WebDownloads } from '../services/web/downloads.js';
import { WebError } from '../services/web/errors.js';
import type { WebImportOptions } from '../services/web/imports.js';
import { WebImports } from '../services/web/imports.js';
import { BrowserDnsScreen, visibleUrl, websiteLabel, websiteRequestHost, websiteUrl } from '../services/web/policy.js';

interface Options extends WebImportOptions {
  metadataDirectory: string;
  archiveWorker: string;
  trustedSender(event: IpcMainInvokeEvent): boolean;
}

interface Tab {
  data: WebTab; view: WebContentsView; url: URL | undefined; adapter: WebAdapter | undefined;
  initialize: Promise<void> | undefined; navigation: number;
}

function websiteIcon(favicons: readonly string[]): string | null {
  // Website-provided URLs never cause the privileged renderer or the main process to fetch.
  const inline = favicons.find(value => value.length <= 22000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value));
  if (!inline) return null;
  const bytes = Buffer.from(inline.slice('data:image/png;base64,'.length), 'base64');
  if (bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' || bytes.readUInt32BE(8) !== 13
    || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 128 || height > 128) return null;
  const icon = nativeImage.createFromBuffer(bytes);
  if (icon.isEmpty()) return null;
  return icon.resize({ width: 24, height: 24 }).toDataURL();
}

async function bounded<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new WebError('TIMEOUT')); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function secureBrowserSession(partition: Session, live: () => boolean): BrowserDnsScreen {
  const dns = new BrowserDnsScreen(async host => (await partition.resolveHost(host)).endpoints.map(item => item.address));
  partition.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
  partition.setPermissionCheckHandler(() => false);
  partition.setDevicePermissionHandler(() => false);
  partition.setDisplayMediaRequestHandler((_request, callback) => { callback({}); });
  partition.on('select-hid-device', (event, _details, callback) => { event.preventDefault(); callback(''); });
  partition.on('select-serial-port', (event, _ports, _contents, callback) => { event.preventDefault(); callback(''); });
  partition.on('select-usb-device', (event, _details, callback) => { event.preventDefault(); callback(); });
  partition.webRequest.onBeforeRequest((details, callback) => {
    const host = websiteRequestHost(details.url, details.resourceType);
    if (!live() || !host) { callback({ cancel: true }); return; }
    void dns.check(host).then(allowed => { callback({ cancel: !allowed || !live() }); }, () => { callback({ cancel: true }); });
  });
  return dns;
}

/** Manages a session and only attaches known tab contents inside the launcher-owned slot. */
class BrowserWorkspace implements WebEndpoint {
  private readonly tabs = new Map<string, Tab>();
  private readonly registry = new WebAdapterRegistry();
  private readonly partition = session.fromPartition(`oucl-web-${randomUUID()}`, { cache: false });
  private readonly dns = secureBrowserSession(this.partition, () => !this.closed && !this.clearing);
  private readonly downloads: WebDownloads;
  private activeId: string | null = null;
  private attached: Tab | undefined;
  private bounds: WebBounds | null = null;
  private popup: { id: string; url: URL; opener: string } | undefined;
  private closed = false;
  private clearing = false;
  private revision = 1;
  private bookmarks: WebSnapshot['bookmarks'] = [];

  constructor(private readonly owner: BrowserWindow, private readonly bookmarkStore: WebBookmarks, downloadDirectory: string,
    reader: WebArchiveReader, private readonly imports: WebImports) {
    this.downloads = new WebDownloads(downloadDirectory, reader, imports, this.changed);
    this.owner.on('resize', this.applyBounds);
    this.owner.on('show', this.applyBounds);
    this.owner.on('restore', this.applyBounds);
    this.owner.on('hide', this.applyBounds);
    this.owner.on('minimize', this.applyBounds);
    this.partition.on('will-download', (event, item, contents, frame) => {
      const tab = this.activeId ? this.tabs.get(this.activeId) : undefined;
      if (this.closed || this.clearing || !this.bounds || !tab || !tab.url || !this.owner.isVisible() || contents !== tab.view.webContents
        || frame != null && frame !== contents.mainFrame) { event.preventDefault(); return; }
      const admitted = this.downloads.admit({
        getURLChain: () => item.getURLChain(), getURL: () => item.getURL(), getTotalBytes: () => item.getTotalBytes(),
        getFilename: () => item.getFilename(), getReceivedBytes: () => item.getReceivedBytes(),
        setSavePath: target => { item.setSavePath(target); }, pause: () => { item.pause(); }, resume: () => { item.resume(); },
        cancel: () => { item.cancel(); }, onDone: listener => { item.once('done', (_event, state) => { listener(state); }); },
        onUpdated: listener => { item.on('updated', (_event, state) => { listener(state); }); },
      });
      if (!admitted) event.preventDefault();
    });
  }

  async initialize(): Promise<BrowserWorkspace> {
    this.bookmarks = await this.bookmarkStore.read();
    return this;
  }

  private readonly changed = (): void => { this.revision++; };

  private snapshot(): WebSnapshot {
    return { revision: this.revision, activeId: this.activeId,
      tabs: [...this.tabs.values()].map(tab => ({ ...tab.data })), bookmarks: this.bookmarks.map(item => ({ ...item })),
      downloads: this.downloads.snapshots(), popup: this.popup ? { id: this.popup.id, origin: this.popup.url.origin } : null,
      packImport: this.imports.hasPackImport };
  }

  private detach(): void {
    if (!this.attached) return;
    this.attached.view.setVisible(false);
    if (!this.owner.isDestroyed()) this.owner.contentView.removeChildView(this.attached.view);
    this.attached = undefined;
  }

  hide(): void {
    this.bounds = null;
    for (const tab of this.tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setAudioMuted(true);
    this.applyBounds();
  }

  private readonly applyBounds = (): void => {
    if (this.owner.isDestroyed()) return;
    const active = this.activeId ? this.tabs.get(this.activeId) : undefined;
    const bounds = this.bounds;
    if (!active || !bounds || this.closed || !this.owner.isVisible() || this.owner.isMinimized() || active.data.status === 'blank'
      || active.data.status === 'failed') { this.detach(); return; }
    const [ownerWidth = 0, ownerHeight = 0] = this.owner.getContentSize();
    const width = Math.min(ownerWidth - bounds.x, bounds.width);
    const height = Math.min(ownerHeight - bounds.y, bounds.height);
    if (bounds.y < 66 || width < 120 || height < 120) { this.detach(); return; }
    if (this.attached !== active) {
      this.detach();
      this.owner.contentView.addChildView(active.view);
      this.attached = active;
    }
    active.view.setBounds({ x: bounds.x, y: bounds.y, width, height });
    active.view.setVisible(true);
    active.view.webContents.setAudioMuted(false);
  };

  private tab(id: string): Tab {
    const tab = this.tabs.get(id);
    if (!tab) throw new WebError('NOT_FOUND');
    return tab;
  }

  private select(tab: Tab): void {
    this.activeId = tab.data.id;
    for (const item of this.tabs.values()) if (!item.view.webContents.isDestroyed()) item.view.webContents.setAudioMuted(item !== tab);
    this.applyBounds(); this.changed();
  }

  private syncTab(tab: Tab): void {
    if (this.closed || !this.tabs.has(tab.data.id)) return;
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return;
    const current = websiteUrl(contents.getURL());
    if (current) {
      if (tab.url?.origin !== current.origin) tab.data.icon = null;
      tab.url = current; tab.data.url = visibleUrl(current);
    }
    const adapter = this.registry.match(current);
    this.registry.change(tab.data.id, tab.adapter, adapter);
    tab.adapter = adapter; tab.data.adapter = adapter?.id ?? null;
    tab.data.canBack = this.historyIndex(tab, -1) !== undefined;
    tab.data.canForward = this.historyIndex(tab, 1) !== undefined;
    this.changed();
  }

  private makeTab(): Tab {
    if (this.tabs.size >= MAX_WEB_TABS) throw new WebError('LIMIT');
    const id = randomUUID();
    const view = new WebContentsView({ webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      session: this.partition, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
      disableDialogs: true, devTools: false,
    } });
    view.setVisible(false);
    const tab: Tab = { data: { id, title: '', url: '', status: 'blank', canBack: false, canForward: false, zoom: 1, icon: null, adapter: null },
      view, url: undefined, adapter: undefined, initialize: undefined, navigation: 0 };
    const contents = view.webContents;
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    const fail = (): void => {
      if (!this.tabs.has(id)) return;
      tab.data.status = tab.url ? 'failed' : 'blank'; this.applyBounds(); this.changed();
    };
    contents.setWindowOpenHandler(details => {
      const url = websiteUrl(details.url);
      if (this.activeId === id && this.bounds && this.owner.isVisible() && url && !details.postBody && !this.popup) {
        this.popup = { id: randomUUID(), url, opener: id }; this.changed();
      }
      return { action: 'deny' };
    });
    contents.on('will-navigate', event => { if (!websiteUrl(event.url)) event.preventDefault(); });
    contents.on('will-frame-navigate', event => {
      if (!websiteUrl(event.url) && (event.isMainFrame || event.url !== 'about:blank')) event.preventDefault();
    });
    contents.on('will-redirect', event => { if (!websiteUrl(event.url)) event.preventDefault(); });
    contents.on('will-attach-webview', event => { event.preventDefault(); });
    contents.on('content-bounds-updated', event => { event.preventDefault(); });
    contents.on('select-bluetooth-device', (event, _devices, callback) => { event.preventDefault(); callback(''); });
    contents.on('login', (event, _details, _auth, callback) => { event.preventDefault(); callback(); });
    contents.on('select-client-certificate', event => { event.preventDefault(); fail(); });
    contents.on('certificate-error', (event, _url, _error, _certificate, callback) => { event.preventDefault(); callback(false); });
    contents.on('did-navigate', () => { this.syncTab(tab); });
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => { if (isMainFrame) this.syncTab(tab); });
    contents.on('did-start-loading', () => {
      if (tab.url) { tab.data.status = 'loading'; this.changed(); }
    });
    contents.on('did-finish-load', () => {
      if (!websiteUrl(contents.getURL())) return;
      tab.data.status = 'ready'; this.syncTab(tab); this.applyBounds();
    });
    contents.on('did-fail-load', (_event, error, _description, failedUrl, isMainFrame) => {
      if (isMainFrame && error !== -3 && failedUrl !== 'about:blank') fail();
    });
    contents.on('page-title-updated', (_event, title) => { tab.data.title = websiteLabel(title, 160); this.changed(); });
    contents.on('page-favicon-updated', (_event, favicons) => { tab.data.icon = websiteIcon(favicons); this.changed(); });
    contents.on('render-process-gone', fail);
    contents.debugger.on('detach', () => {
      if (!this.tabs.has(tab.data.id)) return;
      // Lost chooser interception means the remote contents must be closed before continuing.
      this.closeTab(tab);
    });
    this.tabs.set(id, tab); this.select(tab);
    return tab;
  }

  private closeTab(tab: Tab): void {
    if (this.attached === tab) this.detach();
    this.tabs.delete(tab.data.id);
    this.registry.change(tab.data.id, tab.adapter, undefined);
    if (this.popup?.opener === tab.data.id) this.popup = undefined;
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
    if (this.activeId === tab.data.id) {
      this.activeId = null;
      const next = [...this.tabs.values()].at(-1);
      if (next) this.select(next);
    }
    this.changed();
  }

  private navigate(tab: Tab, url: URL): void {
    const sequence = ++tab.navigation;
    const contents = tab.view.webContents;
    tab.url = url; tab.data.url = visibleUrl(url); tab.data.title = url.hostname; tab.data.icon = null;
    tab.data.status = 'loading'; this.changed(); this.applyBounds();
    tab.initialize ??= (async () => {
      await bounded(contents.loadURL('about:blank'), 5000);
      contents.debugger.attach('1.3');
      await bounded(contents.debugger.sendCommand('Page.enable'), 5000);
      await bounded(contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true }), 5000);
    })();
    const current = () => this.tabs.has(tab.data.id) && tab.navigation === sequence && !contents.isDestroyed();
    void (async () => {
      await tab.initialize;
      if (!current()) return;
      if (!await this.dns.check(url.hostname)) throw new WebError('URL_BLOCKED');
      if (!current()) return;
      await bounded(contents.loadURL(url.href), 30000);
    })().catch(() => {
      if (!current()) return;
      contents.stop(); tab.data.status = 'failed'; this.changed(); this.applyBounds();
    });
  }

  private historyIndex(tab: Tab, move: -1 | 1): number | undefined {
    const history = tab.view.webContents.navigationHistory;
    const index = history.getActiveIndex() + move;
    if (index < 0 || index >= history.length()) return;
    const target = history.getEntryAtIndex(index);
    return target && websiteUrl(target.url) ? index : undefined;
  }

  private history(tab: Tab, move: -1 | 1): void {
    const index = this.historyIndex(tab, move);
    if (index !== undefined) tab.view.webContents.navigationHistory.goToIndex(index);
  }

  private async clear(): Promise<void> {
    this.clearing = true;
    try {
      for (const tab of this.tabs.values()) this.closeTab(tab);
      this.downloads.cancelPending();
      await bounded(Promise.all([this.partition.clearStorageData(), this.partition.clearCache(), this.partition.closeAllConnections()]), 8000);
    } finally { this.clearing = false; }
  }

  async run(action: WebAction, trusted: () => boolean): Promise<WebSnapshot> {
    if (this.closed || this.clearing) throw new WebError('UNAVAILABLE');
    switch (action.kind) {
      case 'state': break;
      case 'layout': this.bounds = action.bounds; this.applyBounds(); break;
      case 'deactivate': this.hide(); this.popup = undefined; this.downloads.cancelPending(); this.changed(); break;
      case 'newTab': this.makeTab(); break;
      case 'clearSession': await this.clear(); break;
      case 'open': case 'navigate': {
        const url = websiteUrl(action.url, true);
        if (!url) throw new WebError('URL_BLOCKED');
        this.navigate(action.kind === 'open' ? this.makeTab() : this.tab(action.tabId), url); break;
      }
      case 'select': this.select(this.tab(action.tabId)); break;
      case 'closeTab': this.closeTab(this.tab(action.tabId)); break;
      case 'back': this.history(this.tab(action.tabId), -1); break;
      case 'forward': this.history(this.tab(action.tabId), 1); break;
      case 'reload': {
        const tab = this.tab(action.tabId);
        if (tab.url) {
          if (websiteUrl(tab.view.webContents.getURL())?.href === tab.url.href) tab.view.webContents.reload();
          else this.navigate(tab, tab.url);
        }
        break;
      }
      case 'zoom': {
        const tab = this.tab(action.tabId); tab.view.webContents.setZoomFactor(action.factor);
        tab.data.zoom = action.factor; this.changed(); break;
      }
      case 'external': {
        const url = this.tab(action.tabId).url;
        if (!url) throw new WebError('URL_BLOCKED');
        await shell.openExternal(visibleUrl(url)); break;
      }
      case 'bookmark': {
        const tab = this.tab(action.tabId);
        if (!tab.url) throw new WebError('URL_BLOCKED');
        const url = visibleUrl(tab.url);
        const title = tab.data.title || tab.url.hostname;
        this.bookmarks = await this.bookmarkStore.update(items => items.some(item => item.url === url)
          ? items : [...items, { id: randomUUID(), url, title }]); this.changed(); break;
      }
      case 'openBookmark': {
        const item = this.bookmarks.find(bookmark => bookmark.id === action.bookmarkId);
        const url = item && websiteUrl(item.url);
        if (!url) throw new WebError('NOT_FOUND');
        this.navigate(this.makeTab(), url); break;
      }
      case 'removeBookmark':
        this.bookmarks = await this.bookmarkStore.update(items => items.filter(item => item.id !== action.bookmarkId)); this.changed(); break;
      case 'acceptPopup': case 'dismissPopup': {
        const popup = this.popup;
        if (!popup || popup.id !== action.popupId) throw new WebError('NOT_FOUND');
        this.popup = undefined; this.changed();
        if (action.kind === 'acceptPopup') this.navigate(this.makeTab(), popup.url);
        break;
      }
      case 'download': this.downloads.confirm(action.downloadId); break;
      case 'cancelDownload': this.downloads.cancel(action.downloadId); break;
      case 'removeDownload': await this.downloads.remove(action.downloadId); break;
      case 'exportDownload':
        await this.downloads.export(action.downloadId, async filename => {
          const selected = await dialog.showSaveDialog(this.owner, { defaultPath: filename });
          return selected.canceled ? undefined : selected.filePath;
        }, trusted); break;
      case 'prepareMod': await this.downloads.prepareMod(action.downloadId, trusted); break;
      case 'importAddon': await this.downloads.install(action.downloadId, action.instanceId, action.revision, trusted); break;
      case 'installPack': await this.downloads.installPack(action.downloadId, action.name, trusted); break;
      case 'skinDraft': {
        const skinDraft = await this.downloads.skinDraft(action.downloadId, trusted);
        return { ...this.snapshot(), skinDraft };
      }
    }
    return this.snapshot();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.owner.removeListener('resize', this.applyBounds); this.owner.removeListener('show', this.applyBounds);
    this.owner.removeListener('restore', this.applyBounds); this.owner.removeListener('hide', this.applyBounds);
    this.owner.removeListener('minimize', this.applyBounds);
    const downloading = this.downloads.close();
    for (const tab of this.tabs.values()) this.closeTab(tab);
    await bounded(Promise.allSettled([this.partition.closeAllConnections(), this.partition.clearStorageData(), this.partition.clearCache()]), 5000).catch(() => {});
    await bounded(downloading, 15000).catch(() => {});
  }
}

export interface WebExtensionRuntime {
  hideOwner(senderId: number): void;
  closeOwner(senderId: number): Promise<void>;
  close(): Promise<void>;
}

/** Registers Web Extensions only after the private workspace is ready. */
export async function registerElectronWebExtensions(options: Options): Promise<WebExtensionRuntime> {
  const root = await ensureChildDirectory(options.metadataDirectory, 'web-extensions');
  const downloadRoot = await ensureChildDirectory(root, 'downloads');
  const bookmarks = new WebBookmarks(root);
  const archive = new WebArchiveReader(options.archiveWorker);
  const imports = new WebImports(options);
  const owners = new Map<number, Promise<BrowserWorkspace>>();
  let closed = false;
  async function closeOwner(id: number): Promise<void> {
    const pending = owners.get(id);
    owners.delete(id);
    if (pending) await pending.then(workspace => workspace.close(), () => {});
  }
  ipcMain.handle(WEB_EXTENSIONS_CHANNEL, (event, input: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || closed) return webFailure(randomUUID(), 'INVALID_SENDER');
    const id = event.sender.id;
    const trusted = () => !closed && !owner.isDestroyed() && options.trustedSender(event);
    return handleWebExtensions(input, trusted, async () => {
      let pending = owners.get(id);
      if (!pending) {
        pending = (async () => {
          const directory = await ensureChildDirectory(downloadRoot, randomUUID());
          if (!trusted()) throw new WebError('INVALID_SENDER');
          const workspace = new BrowserWorkspace(owner, bookmarks, directory, archive, imports);
          try { return await workspace.initialize(); }
          catch (error) { await workspace.close(); throw error; }
        })();
        owners.set(id, pending);
        const operation = pending;
        void operation.catch(() => { if (owners.get(id) === operation) owners.delete(id); });
      }
      return pending;
    });
  });
  return {
    hideOwner(id) { void owners.get(id)?.then(workspace => workspace.hide(), () => {}); },
    closeOwner,
    async close() {
      if (closed) return;
      closed = true; ipcMain.removeHandler(WEB_EXTENSIONS_CHANNEL);
      await Promise.all([...owners.keys()].map(closeOwner));
    },
  };
}
