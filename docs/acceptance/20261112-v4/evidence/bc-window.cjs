// Launch only by the main coordinator. This file does not replace IPC, domains, preload or renderer components.
const { app, session } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const base = __dirname; const seed = JSON.parse(fs.readFileSync(path.join(base, 'seed.json'), 'utf8'));
const mode = process.argv.find(arg => arg.startsWith('--bc-run='))?.slice(9) || 'cold';
if (!/^[a-z0-9-]{1,32}$/.test(mode)) throw new Error('INVALID_RUN_LABEL');
const log = path.join(base, `window-${mode}.jsonl`);
const record = value => fs.appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), ...value }) + '\n');
app.setPath('userData', seed.profile); app.disableHardwareAcceleration();
delete process.env.OUCL_PORTABLE_ROOT;
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    let delayMs = 0;
    try { delayMs = Math.min(5000, Math.max(0, JSON.parse(fs.readFileSync(path.join(base, 'network-hold.json'), 'utf8')).delayMs || 0)); } catch { /* Immediate offline default. */ }
    if (!details.url.startsWith('https://api.modrinth.com/')) delayMs = 0;
    record({ kind: 'network-block', endpoint: details.url.startsWith('https://api.modrinth.com/') ? 'modrinth' : 'other', controlledWaitMs: delayMs });
    if (delayMs) setTimeout(() => callback({ cancel: true }), delayMs); else callback({ cancel: true });
  });
});
app.on('browser-window-created', (_event, window) => {
  let timer;
  window.webContents.once('did-finish-load', () => {
    let busy = false; let previous = '';
    timer = setInterval(() => {
      if (busy || window.isDestroyed()) return; busy = true;
      void window.webContents.executeJavaScript(`(async()=>{
        if(!window.oucl) return {bridgeAbsent:true};
        const selected=document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id');
        const report=document.querySelector('.mod-report');
        return {selected,reportInstance:report?.getAttribute('data-instance-id'),reportTime:report?.getAttribute('data-report-time'),
          status:document.querySelector('[data-status]')?.getAttribute('data-status'),
          modPanel:document.querySelector('.mods-panel')?.textContent,
          taskPanels:Array.from(document.querySelectorAll('.install-task')).map(x=>x.textContent),
          handshake:await window.oucl.handshake(),nodeAbsent:typeof require==='undefined'&&typeof process==='undefined',
          targets:selected?await window.oucl.listInstanceTaskTargets({instanceId:selected,kinds:['mod-check'],limit:100}):null};
      })()`).then(value => {
        const text = JSON.stringify(value); if (text !== previous) { previous = text; record({ kind: 'public-and-dom', value }); }
      }).catch(error => record({ kind: 'harness-error', code: error.name })).finally(() => { busy = false; });
    }, 1500);
    const prefs = window.webContents.getLastWebPreferences();
    record({ kind: 'loaded', security: { contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration } });
  });
  window.once('closed', () => { clearInterval(timer); record({ kind: 'window-closed' }); });
});
app.on('will-quit', () => record({ kind: 'will-quit' })); process.on('exit', code => record({ kind: 'exit', code }));
require(path.join(base, 'product/main/index.cjs'));
