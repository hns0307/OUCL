// Coordinator-only GUI entry: production components/domains unchanged, fresh formal-install synthetic profile.
const { app, session } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const base = __dirname, seed = JSON.parse(fs.readFileSync(path.join(base, 'seed.json'), 'utf8'));
const mode = process.argv.find(arg => arg.startsWith('--global-run='))?.slice(13) || 'cold';
if (!/^[a-z0-9-]{1,32}$/.test(mode)) throw new Error('INVALID_LABEL');
const record = value => fs.appendFileSync(path.join(base, `window-${mode}.jsonl`), JSON.stringify({ time: new Date().toISOString(), ...value }) + '\n');
app.setPath('userData', seed.profile); app.disableHardwareAcceleration(); delete process.env.OUCL_PORTABLE_ROOT;
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_details, callback) => {
    record({ kind: 'network-block' }); callback({ cancel: true });
  });
});
app.on('browser-window-created', (_event, window) => {
  let timer;
  window.webContents.once('did-finish-load', () => {
    const preferences = window.webContents.getLastWebPreferences();
    record({ kind: 'loaded', security: { contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration } });
    let busy = false;
    timer = setInterval(() => {
      if (busy || window.isDestroyed()) return; busy = true;
      void window.webContents.executeJavaScript(`(async()=>{
        if(!window.oucl)return {bridgeAbsent:true};
        const tasks=await window.oucl.listTasks({limit:100});
        const taskCenter=document.querySelector('[aria-label="任务记录"]');
        return {tasks,handshake:await window.oucl.handshake(),nodeAbsent:typeof require==='undefined'&&typeof process==='undefined',
          selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),
          reportInstance:document.querySelector('.mod-report')?.getAttribute('data-instance-id'),
          taskCenter:taskCenter?.textContent,
          taskCards:Array.from(document.querySelectorAll('.install-task')).map(card=>({taskId:card.getAttribute('data-task-id'),state:card.getAttribute('data-task-state'),
            observation:card.querySelector('[data-observation-state]')?.getAttribute('data-observation-state'),text:card.textContent}))};
      })()`).then(value => record({ kind: 'public-and-dom', value })).catch(error => record({ kind: 'harness-error', code: error.name }))
        .finally(() => { busy = false; });
    }, 1500);
  });
  window.once('closed', () => { clearInterval(timer); record({ kind: 'window-closed' }); });
});
app.on('will-quit', () => record({ kind: 'will-quit' })); process.on('exit', code => record({ kind: 'exit', code }));
require(path.join(base, 'product/main/index.cjs'));
