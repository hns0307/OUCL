// Observation harness only. Launch by the coordinating chat; no automatic picker
// selection/cancellation, business invocation, window close, or worker termination.
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const workerThreads = require('node:worker_threads');
const root = path.resolve(__dirname, '../..');
const product = path.join(root, 'dist');
const caseRoot = path.join(__dirname, 'native-case');
const profile = path.join(caseRoot, 'profile');
const games = path.join(caseRoot, 'OUCL.games');
const harnessApp = path.join(__dirname, 'native-app');
const logFile = path.join(__dirname, 'native-events.jsonl');
const packChannel = 'packs:inspectFixed';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'acceptance-results/product-manifest.json'), 'utf8'));
if (manifest.length !== 7) throw new Error('EXPECTED_SEVEN_PRODUCT_FILES');
for (const entry of manifest) {
  const file = path.resolve(product, entry.path); const relative = path.relative(product, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(file).isSymbolicLink()) throw new Error('UNSAFE_PRODUCT_FILE');
  if (sha(fs.readFileSync(file)) !== entry.sha256) throw new Error('PRODUCT_HASH_MISMATCH');
}
// Launch the small native-app directory, not this file directly. This keeps the
// approved data root outside Electron's protected harness application directory.
if (path.resolve(app.getAppPath()) !== harnessApp) throw new Error('LAUNCH_NATIVE_APP_DIRECTORY_REQUIRED');
if (fs.existsSync(caseRoot) || fs.existsSync(logFile)) throw new Error('NATIVE_CASE_EXISTS_DO_NOT_REUSE');
fs.mkdirSync(caseRoot); fs.mkdirSync(profile);
fs.writeFileSync(path.join(__dirname, 'native-case.json'), JSON.stringify({ caseRoot, profile, games, product, productManifest: manifest,
  intervention: 'First pack chooser call only: 1500ms timer reloads the test-owned main document if native promise still pending. All later native interaction is manual.' }, null, 2), { flag: 'wx' });
let sequence = 0;
const log = (kind, fields = {}) => fs.appendFileSync(logFile, JSON.stringify({ sequence: sequence++, time: new Date().toISOString(), kind, ...fields }) + '\n');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
process.env.OUCL_PORTABLE_ROOT = caseRoot;
const originalDialog = dialog.showOpenDialog;
const originalHandle = ipcMain.handle;
const OriginalWorker = workerThreads.Worker;
const timers = new Set(); const windowTimers = new Map(); const choiceByFile = new Map();
let currentPackCall; let chooserOrdinal = 0; let reloadReserved = false; let packWorkers = 0;
const fileKey = file => path.resolve(file).toLowerCase();
const clearTimer = timer => { if (timer) { clearTimeout(timer); timers.delete(timer); } };

// Transparent construction observation: original constructor, entry and options are
// passed unchanged. No fake Worker, data read, message, result, or exit is supplied.
let WorkerProxy;
WorkerProxy = new Proxy(OriginalWorker, { construct(target, args, newTarget) {
  const worker = Reflect.construct(target, args, newTarget === WorkerProxy ? target : newTarget);
  const job = args[1]?.workerData;
  if (job?.kind === 'fixed-pack-preview') {
    const choice = typeof job.file === 'string' ? choiceByFile.get(fileKey(job.file)) : undefined;
    const ordinal = ++packWorkers;
    log('pack-worker-created', { ordinal, chooserOrdinal: choice?.ordinal ?? null, requestId: choice?.requestId ?? null, threadId: worker.threadId });
    worker.once('exit', code => log('pack-worker-exit', { ordinal, exitCode: code }));
  }
  return worker;
} });
workerThreads.Worker = WorkerProxy;

ipcMain.handle = function (channel, handler) {
  if (channel !== packChannel) return Reflect.apply(originalHandle, this, [channel, handler]);
  return Reflect.apply(originalHandle, this, [channel, async (event, input) => {
    const requestId = typeof input?.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(input.requestId) ? input.requestId : null;
    const context = { requestId, senderId: event.sender.id };
    log('pack-handler-handled', context);
    const previous = currentPackCall; let pending;
    try { currentPackCall = context; pending = handler(event, input); }
    catch (error) { log('pack-handler-threw', { ...context, errorName: error?.name }); throw error; }
    finally { currentPackCall = previous; }
    try {
      const result = await pending;
      log('pack-handler-returned', { ...context, ok: result?.ok, code: result?.error?.code ?? null, state: result?.data?.state ?? null, packWorkers });
      return result;
    } catch (error) { log('pack-handler-rejected', { ...context, errorName: error?.name }); throw error; }
  }]);
};

dialog.showOpenDialog = function (...args) {
  const options = args[1] ?? args[0];
  const isPack = options?.filters?.some(filter => filter.extensions?.includes('mrpack'));
  if (!isPack) return Reflect.apply(originalDialog, this, args);
  const owner = args[0] instanceof BrowserWindow ? args[0] : undefined;
  const context = currentPackCall;
  const ordinal = ++chooserOrdinal; let settled = false; let reloadTimer;
  log('choose-called', { ordinal, requestId: context?.requestId ?? null, ownerId: owner?.id ?? null });
  let native;
  try { native = Reflect.apply(originalDialog, this, args); }
  catch (error) { log('choose-settled', { ordinal, outcome: 'synchronous-rejection', errorName: error?.name }); throw error; }
  if (!reloadReserved) {
    reloadReserved = true;
    if (!owner) { log('reload-not-scheduled', { ordinal, reason: 'NO_NATIVE_OWNER' }); }
    else {
      reloadTimer = setTimeout(() => {
        timers.delete(reloadTimer);
        if (settled || owner.isDestroyed() || owner.webContents.isDestroyed()) {
          log('reload-not-fired', { ordinal, reason: settled ? 'CHOOSER_ALREADY_SETTLED' : 'OWNER_GONE' }); return;
        }
        log('reload-intervention', { ordinal, ownerId: owner.id, senderId: owner.webContents.id, reason: 'TEST_ONLY_DOCUMENT_INVALIDATION', nativePending: true });
        try { owner.webContents.reload(); }
        catch (error) { log('reload-rejected', { ordinal, errorName: error?.name }); }
      }, 1500);
      reloadTimer.unref?.(); timers.add(reloadTimer);
      log('reload-scheduled', { ordinal, afterMs: 1500, onlyFirstChooser: true });
    }
  }
  // Do not synthesize settlement or keep a separate gate promise. Original result
  // (including real paths) is returned unmodified to the original domain handler.
  return native.then(result => {
    settled = true; clearTimer(reloadTimer);
    if (Array.isArray(result?.filePaths)) for (const file of result.filePaths) choiceByFile.set(fileKey(file), { ordinal, requestId: context?.requestId });
    log('choose-settled', { ordinal, requestId: context?.requestId ?? null, outcome: 'resolved', canceled: result?.canceled, pathCount: result?.filePaths?.length ?? 0 });
    return result;
  }, error => {
    settled = true; clearTimer(reloadTimer);
    log('choose-settled', { ordinal, requestId: context?.requestId ?? null, outcome: 'rejected', errorName: error?.name }); throw error;
  });
};

const installedSessions = new WeakSet();
function blockNetwork(s) {
  if (installedSessions.has(s)) return; installedSessions.add(s);
  s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    let origin = 'unparsed'; try { origin = new URL(details.url).origin; } catch {}
    log('network-blocked', { origin }); callback({ cancel: true });
  });
}
app.on('session-created', blockNetwork);
app.whenReady().then(() => blockNetwork(session.defaultSession));
app.on('browser-window-created', (_event, window) => {
  const windowId = window.id;
  const contents = window.webContents; const senderId = contents.id;
  let generation = 0; let lastDom; let observing = false;
  log('window-created', { windowId: windowId, senderId });
  const expression = `(() => {
    const panel = [...document.querySelectorAll('section.panel')].find(s => s.querySelector('h2')?.textContent === '检查整合包样本');
    if (!panel) return {panel:'absent',connected:!!document.querySelector('[data-status="connected"]')};
    const text=panel.textContent||'';
    return {panel:'present',connected:!!document.querySelector('[data-status="connected"]'),buttonDisabled:!!panel.querySelector('button')?.disabled,
      waiting:text.includes('正在等待文件选择或检查完成'),cancelled:text.includes('未选择文件'),
      preview:text.includes('Minecraft 1.20.1')&&text.includes('FerriteCore 6.0.1')&&text.includes('当前不可安装'),
      alert:!!panel.querySelector('[role="alert"]'),nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'};
  })()`;
  const observe = () => {
    if (observing || contents.isDestroyed() || contents.isLoadingMainFrame()) return;
    observing = true; const currentGeneration = generation;
    contents.executeJavaScript(expression, false).then(value => {
      const snapshot = JSON.stringify({ generation: currentGeneration, value });
      if (snapshot !== lastDom) { lastDom = snapshot; log('dom-fixed-preview', { windowId: windowId, generation: currentGeneration, value }); }
    }).catch(error => log('dom-observation-unavailable', { windowId: windowId, generation: currentGeneration, errorName: error?.name }))
      .finally(() => { observing = false; });
  };
  const timer = setInterval(observe, 400); timer.unref?.(); windowTimers.set(windowId, timer);
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame) { generation++; lastDom = undefined; }
    log('did-start-navigation', { windowId: windowId, generation, mainFrame, inPlace });
  });
  contents.on('did-finish-load', () => { log('did-finish-load', { windowId: windowId, generation }); observe(); });
  contents.once('destroyed', () => {
    clearInterval(timer); windowTimers.delete(windowId); log('sender-destroyed', { senderId, windowId: windowId });
    // A scheduled first-dialog reload must never target a destroyed window.
    for (const pending of timers) clearTimeout(pending); timers.clear();
  });
  window.on('close', () => log('window-close', { windowId: windowId }));
  window.once('closed', () => log('window-closed', { windowId: windowId }));
});
function clearAllTimers() {
  for (const timer of timers) clearTimeout(timer); timers.clear();
  for (const timer of windowTimers.values()) clearInterval(timer); windowTimers.clear();
}
app.on('before-quit', () => { clearAllTimers(); log('before-quit'); });
app.on('will-quit', () => {
  clearAllTimers(); dialog.showOpenDialog = originalDialog; ipcMain.handle = originalHandle; workerThreads.Worker = OriginalWorker;
  log('will-quit', { packWorkers });
});
process.on('exit', code => { clearAllTimers(); log('exit', { code }); });
process.on('uncaughtExceptionMonitor', error => log('uncaught-exception-observed', { errorName: error?.name }));
log('harness-preflight', { manifestFiles: manifest.length, independentProfile: true, networkBlocked: true, noAutomaticSelection: true });
require(path.join(product, 'main/index.cjs'));
