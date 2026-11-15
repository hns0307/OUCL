import { WebContentsView, session } from 'electron';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { onlineToolUrlAllowed, ONLINE_TOOL_REGISTRY } from '../core/tools/online-policy.js';
import type { OnlineToolDefinition } from '../core/tools/online-policy.js';
import { OnlineToolService } from '../services/tools/service.js';
import type { OnlineToolView, OnlineToolViewFactory } from '../services/tools/service.js';

const RESTRICTED_DOCUMENT_CSP = "frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('TOOL_TIMEOUT')); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Main-process adapter: every open gets a new nonpersistent session, never the application's preload/session. */
export class ElectronOnlineToolFactory implements OnlineToolViewFactory {
  constructor(private readonly owner: BrowserWindow, private readonly topInset = 260, private readonly bottomInset = 32) {
    if (!Number.isInteger(topInset) || topInset < 260 || !Number.isInteger(bottomInset) || bottomInset < 32) throw new Error('INVALID_TOOL_LAYOUT');
  }
  create(tool: OnlineToolDefinition, failed: () => void): OnlineToolView {
    const isolated = session.fromPartition(`oucl-online-${randomUUID()}`, { cache: false });
    let closed = false;
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
    isolated.setPermissionCheckHandler(() => false);
    isolated.setDevicePermissionHandler(() => false);
    isolated.setDisplayMediaRequestHandler((_request, callback) => { callback({}); });
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const kind = details.resourceType === 'mainFrame' ? 'document' : 'resource';
      callback({ cancel: closed || details.resourceType === 'subFrame' || !['GET', 'HEAD'].includes(details.method)
        || !onlineToolUrlAllowed(tool, details.url, kind) });
    });
    isolated.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      if (details.resourceType === 'mainFrame') {
        // Additional CSP only tightens the remote document; the local app CSP is untouched.
        const key = Object.keys(responseHeaders).find(name => name.toLowerCase() === 'content-security-policy') ?? 'Content-Security-Policy';
        responseHeaders[key] = [...(responseHeaders[key] ?? []), RESTRICTED_DOCUMENT_CSP];
      }
      callback({ responseHeaders });
    });
    isolated.on('will-download', (event, item) => { event.preventDefault(); item.cancel(); });
    isolated.on('select-hid-device', (event, _details, callback) => { event.preventDefault(); callback(''); });
    isolated.on('select-serial-port', (event, _ports, _contents, callback) => { event.preventDefault(); callback(''); });
    isolated.on('select-usb-device', (event, _details, callback) => { event.preventDefault(); callback(); });
    const view = new WebContentsView({ webPreferences: {
      session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      navigateOnDragDrop: false, disableDialogs: true, devTools: false,
    } });
    const contents = view.webContents;
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    view.setVisible(false);
    const fail = (): void => { if (!closed) failed(); };
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => { if (!onlineToolUrlAllowed(tool, event.url, 'document')) event.preventDefault(); });
    contents.on('will-frame-navigate', event => {
      if (!event.isMainFrame || !onlineToolUrlAllowed(tool, event.url, 'document')) event.preventDefault();
    });
    contents.on('will-redirect', event => {
      if (!event.isMainFrame || !onlineToolUrlAllowed(tool, event.url, 'document')) event.preventDefault();
    });
    contents.on('will-attach-webview', event => { event.preventDefault(); });
    contents.on('select-bluetooth-device', (event, _devices, callback) => { event.preventDefault(); callback(''); });
    contents.on('login', (event, _details, _auth, callback) => { event.preventDefault(); callback(); });
    contents.on('select-client-certificate', event => { event.preventDefault(); fail(); });
    contents.on('certificate-error', (event, _url, _error, _certificate, callback) => { event.preventDefault(); callback(false); });
    contents.on('render-process-gone', fail);
    contents.on('destroyed', fail);
    contents.debugger.on('detach', fail);
    let attached = false;
    const layout = (): void => {
      if (closed || this.owner.isDestroyed()) return;
      const [width = 0, height = 0] = this.owner.getContentSize();
      const available = height - this.topInset - this.bottomInset;
      view.setBounds({ x: 0, y: this.topInset, width: Math.max(0, width), height: Math.max(0, available) });
      view.setVisible(attached && available >= 160 && width >= 360);
    };
    const disposeOwner = (): void => { fail(); };
    this.owner.on('resize', layout);
    this.owner.once('closed', disposeOwner);
    let disposing: Promise<void> | undefined;
    return {
      load: async () => {
        if (closed || this.owner.isDestroyed() || !onlineToolUrlAllowed(tool, tool.entryUrl, 'document')) throw new Error('INVALID_TOOL_LOAD');
        // A fresh WebContentsView has no renderer target until its first navigation. Initialize only a fixed empty page.
        await bounded(contents.loadURL('about:blank'), 3000);
        if (closed || contents.isDestroyed()) throw new Error('TOOL_CLOSED');
        contents.debugger.attach('1.3');
        await bounded(contents.debugger.sendCommand('Page.enable'), 3000);
        // CDP intercepts native file choosers before any untrusted document is loaded. Failure is fail-closed.
        await bounded(contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true }), 3000);
        if (closed || this.owner.isDestroyed()) throw new Error('TOOL_CLOSED');
        this.owner.contentView.addChildView(view); attached = true; layout();
        await bounded(contents.loadURL(tool.entryUrl), 15000);
      },
      dispose: () => {
        if (disposing) return disposing;
        // Hide/detach synchronously, before waiting for network or browsing-data cleanup.
        closed = true; view.setVisible(false);
        this.owner.removeListener('resize', layout); this.owner.removeListener('closed', disposeOwner);
        if (attached && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(view);
        attached = false;
        disposing = (async () => {
          const destroyed = contents.isDestroyed() ? Promise.resolve() : new Promise<void>(resolve => {
            contents.once('destroyed', () => { resolve(); });
            contents.stop(); contents.close({ waitForBeforeUnload: false });
          });
          await bounded(destroyed, 3000);
          const cleanup = await bounded(Promise.allSettled([isolated.closeAllConnections(), isolated.clearStorageData(), isolated.clearCache()]), 5000);
          if (cleanup.some(result => result.status === 'rejected')) throw new Error('TOOL_CLEANUP_FAILED');
        })();
        return disposing;
      },
    };
  }
}

/** Default product registry is empty until a specific site and required origins have been reviewed. */
export function createElectronOnlineToolService(owner: BrowserWindow, registry: readonly OnlineToolDefinition[] = ONLINE_TOOL_REGISTRY, topInset = 260): OnlineToolService {
  return new OnlineToolService(new ElectronOnlineToolFactory(owner, topInset), registry);
}
