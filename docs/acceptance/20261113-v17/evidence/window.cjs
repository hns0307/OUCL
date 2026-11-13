// Coordinator-only running-cancel scenario. Original net.request/IPC/domain results remain unchanged.
const { app, session, ipcMain, net } = require('electron');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const base = __dirname, product = path.resolve(base, '../product'), fixture = path.resolve(base, '../v4-bc');
if (fs.existsSync(path.join(base, 'window.jsonl'))) throw new Error('EXISTING_RUN_PRESERVED');
const seed = JSON.parse(fs.readFileSync(path.join(fixture, 'seed.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.resolve(base, '../product-manifest.json'), 'utf8'));
for (const item of manifest) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(product, item.path))).digest('hex') !== item.sha256) throw new Error('PRODUCT_CHANGED');
}
fs.writeFileSync(path.join(base, 'verified-product.json'), JSON.stringify(manifest, null, 2));
const record = value => fs.appendFileSync(path.join(base, 'window.jsonl'), JSON.stringify({ time: new Date().toISOString(), monoMs: performance.now(), ...value }) + '\n');
const target = value => value === 'https://api.modrinth.com/v2/version_files';
app.setPath('userData', seed.profile); app.disableHardwareAcceleration(); delete process.env.OUCL_PORTABLE_ROOT;
let first, heldOnce = false, heldRequest, callbackHold, domTimer, requestSequence = 0, ipcSequence = 0;
const originalRequest = net.request.bind(net);
function releaseCallback(reason) {
  const hold = callbackHold; if (!hold) return; callbackHold = undefined; clearTimeout(hold.safety);
  record({ kind: 'webrequest-callback-release', reason, request: hold.request, elapsedMs: performance.now() - hold.startedMono });
  try { hold.callback({ cancel: true }); } // Never allow an outbound request or fabricate a response.
  catch (error) { record({ kind: 'webrequest-callback-release-error', errorName: error.name }); }
}
net.request = function (...args) {
  const request = originalRequest(...args), options = args[0];
  const url = typeof options === 'string' ? options : options?.url;
  if (!target(url)) return request;
  const id = ++requestSequence, createdMono = performance.now();
  const observed = { id, createdMono, aborted: false, closed: false };
  if (!heldOnce && !heldRequest) heldRequest = observed;
  record({ kind: 'real-request-created', request: id, phase: 'version_files-after-initial-inventory-scan',
    inference: 'Production inspection awaits initial inventory/JAR worker before platform; no independent worker counter.' });
  const originalAbort = request.abort;
  request.abort = function (...abortArgs) {
    observed.aborted = true;
    record({ kind: 'real-request-abort-called', request: id, elapsedMs: performance.now() - createdMono,
      signalMeaning: 'Observes original ClientRequest.abort effect; no direct AbortSignal identity instrumentation.' });
    try { return originalAbort.apply(this, abortArgs); }
    finally { queueMicrotask(() => { if (callbackHold?.request === id) releaseCallback('after-original-request-abort'); }); }
  };
  request.once('abort', () => {
    observed.aborted = true; record({ kind: 'real-request-abort-event', request: id, elapsedMs: performance.now() - createdMono });
    if (callbackHold?.request === id) releaseCallback('after-original-abort-event');
  });
  request.once('close', () => {
    observed.closed = true; record({ kind: 'real-request-close', request: id, elapsedMs: performance.now() - createdMono });
    if (callbackHold?.request === id) releaseCallback('after-original-request-close');
  });
  request.once('error', error => record({ kind: 'real-request-error', request: id, errorName: error.name }));
  request.once('response', response => record({ kind: 'unexpected-network-response', request: id, status: response.statusCode }));
  return request; // Same real ClientRequest, with passive events and delegating abort instrumentation only.
};
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (details, callback) => {
    if (target(details.url) && !heldOnce && heldRequest && !heldRequest.aborted && !heldRequest.closed) {
      heldOnce = true;
      const hold = { request: heldRequest.id, callback, startedMono: performance.now(), safety: undefined };
      callbackHold = hold;
      // Product's own12s timeout/GUI cancellation is untouched. This15s fallback is only fail-closed test cleanup.
      hold.safety = setTimeout(() => { record({ kind: 'hold-safety-expired', request: hold.request }); releaseCallback('test-safety-15000ms'); }, 15000);
      record({ kind: 'network-pending', request: hold.request, interceptionId: details.id,
        firstPreviewId: first?.previewId, note: 'GUI cancel must precede production12s timeout; no callback result yet.' });
      fs.writeFileSync(path.join(base, 'network-pending.json'), JSON.stringify({ request: hold.request, first, startedAt: new Date().toISOString(), startedMono: hold.startedMono }, null, 2));
    } else { record({ kind: 'network-block', targetEndpoint: target(details.url) }); callback({ cancel: true }); }
  });
});
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, input) => {
  const invocation = ++ipcSequence;
  if (channel.startsWith('mods:maintenancePreview')) record({ kind: 'ipc-received', invocation, channel, requestId: input?.requestId, input: input?.payload });
  const result = await handler(event, input);
  if (channel.startsWith('mods:maintenancePreview')) {
    record({ kind: 'ipc-handled-returned', invocation, channel, requestId: input?.requestId, input: input?.payload, result,
      meaning: 'Unchanged real result returned to invoke; DOM proves UI consumption separately.' });
    if (channel === 'mods:maintenancePreview' && result?.ok && !first) {
      first = { requestId: input.requestId, input: input.payload, previewId: result.data.previewId };
      fs.writeFileSync(path.join(base, 'first-admission.json'), JSON.stringify(first, null, 2));
    }
  }
  return result;
});
function cleanup(reason) { clearInterval(domTimer); releaseCallback(reason); }
app.on('browser-window-created', (_event, window) => {
  window.once('ready-to-show', () => { window.unmaximize(); window.setBounds({ x: 100, y: 100, width: 1180, height: 820 }); });
  window.webContents.once('did-finish-load', () => {
    const p = window.webContents.getLastWebPreferences(); record({ kind: 'loaded', security: { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration } });
    let busy = false, previous = '';
    domTimer = setInterval(() => {
      if (busy || window.isDestroyed()) return; busy = true;
      void window.webContents.executeJavaScript(`({selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),
        nodeAbsent:typeof require==='undefined'&&typeof process==='undefined',files:Array.from(document.querySelectorAll('.mod-files>li')).map(row=>({
          filename:row.querySelector('.mods-summary strong')?.textContent,previewText:row.querySelector('.maintenance-preview')?.textContent,
          alerts:Array.from(row.querySelectorAll('[role=alert]')).map(node=>node.textContent),
          buttons:Array.from(row.querySelectorAll('.maintenance-preview button')).map(button=>({text:button.textContent,disabled:button.disabled}))}))})`)
        .then(value => { const text = JSON.stringify(value); if (text !== previous) { previous = text; record({ kind: 'dom', value }); } })
        .catch(error => record({ kind: 'dom-error', errorName: error.name })).finally(() => { busy = false; });
    }, 250);
  });
  window.once('closed', () => { cleanup('window-closed-cleanup'); record({ kind: 'window-closed' }); });
});
app.on('before-quit', () => cleanup('before-quit-cleanup'));
app.on('will-quit', () => { cleanup('will-quit-cleanup'); record({ kind: 'will-quit' }); });
process.on('exit', code => record({ kind: 'exit', code }));
require(path.join(product, 'main/index.cjs'));
