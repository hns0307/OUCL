// Coordinator-only real-time response-delay harness. No domain, clock, preload or UI replacement.
const { app, session, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const base = __dirname, fixture = path.resolve(base, '../v4-bc'), product = path.resolve(base, '../product');
const seed = JSON.parse(fs.readFileSync(path.join(fixture, 'seed.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.resolve(base, '../product-manifest.json'), 'utf8'));
for (const item of manifest) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(product, item.path))).digest('hex') !== item.sha256) throw new Error('PRODUCT_CHANGED');
}
fs.writeFileSync(path.join(base, 'verified-product.json'), JSON.stringify(manifest, null, 2));
const record = value => fs.appendFileSync(path.join(base, 'window.jsonl'), JSON.stringify({ time: new Date().toISOString(), monoMs: performance.now(), ...value }) + '\n');
app.setPath('userData', seed.profile); app.disableHardwareAcceleration(); delete process.env.OUCL_PORTABLE_ROOT;
let ownedWindow, first, delayed, delayUsed = false, closing = false, domTimer;

function release(reason) {
  const pending = delayed; if (!pending) return;
  delayed = undefined; clearTimeout(pending.timer);
  record({ kind: 'delivered', channel: pending.channel, requestId: pending.requestId, previewId: pending.result.data.previewId,
    elapsedSinceHandledMs: performance.now() - pending.handledMono, reason,
    deliveryMeaning: 'Original result released to ipcMain invoke completion; not acknowledgement that preload/UI consumed it.', result: pending.result });
  pending.resolve(pending.result);
}
function drain(reason) { closing = true; clearInterval(domTimer); release(reason); }
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, input) => {
  const result = await handler(event, input);
  if (!channel.startsWith('mods:maintenancePreview')) return result;
  const handledMono = performance.now(), handledAt = new Date().toISOString();
  record({ kind: 'handled', channel, requestId: input?.requestId, input: input?.payload, result });
  if (channel === 'mods:maintenancePreview' && result?.ok && !first) {
    first = { requestId: input.requestId, input: input.payload, previewId: result.data.previewId };
  }
  if (!closing && !delayUsed && first && channel === 'mods:maintenancePreviewStatus'
    && result?.ok && result.data.status === 'completed' && result.data.previewId === first.previewId) {
    delayUsed = true;
    Object.assign(first, { completedHandledAt: handledAt, completedHandledMono: handledMono,
      statusRequestId: input.requestId, filename: result.data.result.filename });
    fs.writeFileSync(path.join(base, 'first-delayed.json'), JSON.stringify(first, null, 2));
    // Return the *same* genuine completed result after real elapsed time; preload's normal 3s deadline is untouched.
    return await new Promise(resolve => {
      const timer = setTimeout(() => {
        const marker = { first, elapsedMs: performance.now() - handledMono, dueAt: new Date().toISOString() };
        fs.writeFileSync(path.join(base, 'deadline-reached.json'), JSON.stringify(marker, null, 2));
        record({ kind: 'deadline-reached', ...marker }); release('real-900500ms-deadline');
        if (closing || !ownedWindow || ownedWindow.isDestroyed()) { record({ kind: 'probe-incomplete', reason: 'window-closed' }); return; }
        // Read-only status probe only. It does not change the component state or retry admission.
        void ownedWindow.webContents.executeJavaScript(`window.oucl.maintenancePreviewStatus(${JSON.stringify(first.previewId)})`)
          .then(status => {
            const proof = { ...marker, observedAt: new Date().toISOString(), oldStatus: status,
              scope: 'Harness public-bridge read only; GUI requery/new admission remains manual.' };
            fs.writeFileSync(path.join(base, 'old-status-at-deadline.json'), JSON.stringify(proof, null, 2));
            record({ kind: 'old-status-at-deadline', ...proof });
          }).catch(error => record({ kind: 'probe-error', errorName: error.name }));
      }, 900500);
      delayed = { timer, resolve, result, channel, requestId: input.requestId, handledMono };
      record({ kind: 'response-held', requestId: input.requestId, previewId: first.previewId, waitMs: 900500 });
    });
  }
  record({ kind: 'delivered', channel, requestId: input?.requestId, previewId: result?.data?.previewId,
    elapsedSinceHandledMs: performance.now() - handledMono, reason: 'immediate-original-result', result,
    deliveryMeaning: 'Original handler result returned to invoke; no renderer receipt assertion.' });
  return result;
});
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })));
app.on('browser-window-created', (_event, window) => {
  ownedWindow = window;
  window.once('ready-to-show', () => { window.unmaximize(); window.setBounds({ x: 100, y: 100, width: 1180, height: 820 }); });
  window.webContents.once('did-finish-load', () => {
    const p = window.webContents.getLastWebPreferences();
    record({ kind: 'loaded', security: { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration } });
    let busy = false, previous = '';
    domTimer = setInterval(() => {
      if (busy || window.isDestroyed()) return; busy = true;
      void window.webContents.executeJavaScript(`({selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),
        panel:document.querySelector('.mods-panel')?.textContent,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined',
        files:Array.from(document.querySelectorAll('.mod-files>li')).map(row=>({filename:row.querySelector('.mods-summary strong')?.textContent,
          previewText:row.querySelector('.maintenance-preview')?.textContent,
          alerts:Array.from(row.querySelectorAll('[role=alert]')).map(node=>node.textContent),
          buttons:Array.from(row.querySelectorAll('.maintenance-preview button')).map(button=>({text:button.textContent,disabled:button.disabled}))}))})`)
        .then(value => { const text = JSON.stringify(value); if (text !== previous) { previous = text; record({ kind: 'dom', value }); } })
        .catch(error => record({ kind: 'dom-error', errorName: error.name })).finally(() => { busy = false; });
    }, 1000);
  });
  window.once('closed', () => { drain('window-closed-before-or-after-deadline'); record({ kind: 'window-closed' }); });
});
app.on('before-quit', () => drain('before-quit'));
app.on('will-quit', () => { drain('will-quit'); record({ kind: 'will-quit' }); });
process.on('exit', code => record({ kind: 'exit', code }));
require(path.join(product, 'main/index.cjs'));
