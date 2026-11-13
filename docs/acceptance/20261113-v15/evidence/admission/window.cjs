// Coordinator-only C-R2: delay one real admission receipt. No domain/clock/preload/UI replacement.
const { app, session, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const base = __dirname, fixture = path.resolve(base, '../v4-bc'), product = path.resolve(base, '../product');
if (fs.existsSync(path.join(base, 'window.jsonl'))) throw new Error('EXISTING_RUN_PRESERVED');
const seed = JSON.parse(fs.readFileSync(path.join(fixture, 'seed.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.resolve(base, '../product-manifest.json'), 'utf8'));
for (const item of manifest) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(product, item.path))).digest('hex') !== item.sha256) throw new Error('PRODUCT_CHANGED');
}
fs.writeFileSync(path.join(base, 'verified-product.json'), JSON.stringify(manifest, null, 2));
const record = value => fs.appendFileSync(path.join(base, 'window.jsonl'), JSON.stringify({ time: new Date().toISOString(), monoMs: performance.now(), ...value }) + '\n');
const canonical = input => JSON.stringify(input && Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key]])));
app.setPath('userData', seed.profile); app.disableHardwareAcceleration(); delete process.env.OUCL_PORTABLE_ROOT;
let first, pending, sequence = 0, closing = false, domTimer;
const observationIds = new Set(); let successfulAdmissions = 0;
function release(reason) {
  const hold = pending; if (!hold) return; pending = undefined; clearTimeout(hold.timer);
  record({ kind: 'delivered', invocation: hold.invocation, channel: 'mods:maintenancePreview', requestId: first.requestId,
    result: hold.result, reason, elapsedMs: performance.now() - hold.handledMono,
    meaning: 'Original result released to invoke, not renderer receipt acknowledgement.' });
  hold.resolve(hold.result);
}
function drain(reason) { closing = true; clearInterval(domTimer); release(reason); }
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, input) => {
  const invocation = ++sequence;
  const result = await handler(event, input);
  if (!channel.startsWith('mods:maintenancePreview')) return result;
  const handledMono = performance.now();
  record({ kind: 'handled', invocation, channel, requestId: input?.requestId, input: input?.payload, result });
  if (channel === 'mods:maintenancePreview' && result?.ok) {
    successfulAdmissions++; observationIds.add(result.data.previewId);
    record({ kind: 'public-observation-identity', invocation, requestId: input.requestId, previewId: result.data.previewId,
      input: input.payload, successfulAdmissionHandlerCalls: successfulAdmissions, uniqueReturnedPreviewIds: observationIds.size,
      reusesFirstIdentity: !!first && first.requestId === input.requestId && canonical(first.input) === canonical(input.payload)
        && first.previewId === result.data.previewId,
      meaning: 'Counts original-handler public observation identities, not instrumented inspection/check calls.' });
    if (!first && !closing) {
      const instance = seed.instances.find(item => item.instanceId === input.payload.instanceId);
      first = { requestId: input.requestId, input: input.payload, previewId: result.data.previewId, invocation,
        filename: instance?.report?.files.find(file => file.fileId === input.payload.fileId)?.filename,
        handledMono, handledAt: new Date().toISOString() };
      fs.writeFileSync(path.join(base, 'first-admission.json'), JSON.stringify(first, null, 2));
      return await new Promise(resolve => {
        const timer = setTimeout(() => release('real-8000ms-admission-delay'), 8000);
        pending = { timer, resolve, result, invocation, handledMono };
        record({ kind: 'held', invocation, requestId: first.requestId, previewId: first.previewId, waitMs: 8000 });
      });
    }
  }
  record({ kind: 'delivered', invocation, channel, requestId: input?.requestId, result,
    reason: 'immediate-original-result', elapsedMs: performance.now() - handledMono,
    meaning: 'Original handler return to invoke; UI consumption needs DOM evidence.' });
  return result;
});
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_details, callback) => callback({ cancel: true })));
app.on('browser-window-created', (_event, window) => {
  window.once('ready-to-show', () => { window.unmaximize(); window.setBounds({ x: 100, y: 100, width: 1180, height: 820 }); });
  window.webContents.once('did-finish-load', () => {
    const p = window.webContents.getLastWebPreferences();
    record({ kind: 'loaded', security: { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration } });
    let busy = false, previous = '';
    domTimer = setInterval(() => {
      if (busy || window.isDestroyed()) return; busy = true;
      void window.webContents.executeJavaScript(`({selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),
        nodeAbsent:typeof require==='undefined'&&typeof process==='undefined',
        files:Array.from(document.querySelectorAll('.mod-files>li')).map(row=>({filename:row.querySelector('.mods-summary strong')?.textContent,
          previewText:row.querySelector('.maintenance-preview')?.textContent,
          alerts:Array.from(row.querySelectorAll('[role=alert]')).map(node=>node.textContent),
          buttons:Array.from(row.querySelectorAll('.maintenance-preview button')).map(button=>({text:button.textContent,disabled:button.disabled}))}))})`)
        .then(value => { const text = JSON.stringify(value); if (text !== previous) { previous = text; record({ kind: 'dom', value }); } })
        .catch(error => record({ kind: 'dom-error', errorName: error.name })).finally(() => { busy = false; });
    }, 500);
  });
  window.once('closed', () => { drain('window-closed'); record({ kind: 'window-closed' }); });
});
app.on('before-quit', () => drain('before-quit'));
app.on('will-quit', () => { drain('will-quit'); record({ kind: 'will-quit' }); });
process.on('exit', code => record({ kind: 'exit', code }));
require(path.join(product, 'main/index.cjs'));
