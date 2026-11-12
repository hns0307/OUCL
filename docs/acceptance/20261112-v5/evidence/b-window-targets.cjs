// Coordinator-only launcher. All application code and the existing profile remain unchanged.
const { app, session } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const output = __dirname, base = path.resolve(output, '../v4-bc');
const seed = JSON.parse(fs.readFileSync(path.join(base, 'seed.json'), 'utf8'));
const label = process.argv.find(arg => arg.startsWith('--bc-run='))?.slice(9) || 'targets';
if (!/^[a-z0-9-]{1,32}$/.test(label)) throw new Error('INVALID_LABEL');
const log = path.join(output, `window-${label}.jsonl`);
const record = value => fs.appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), ...value }) + '\n');
app.setPath('userData', seed.profile); app.disableHardwareAcceleration(); delete process.env.OUCL_PORTABLE_ROOT;
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    // Same controlled network-only delay as the existing active harness. No profile/domain writes.
    const delayMs = details.url.startsWith('https://api.modrinth.com/') ? 5000 : 0;
    record({ kind: 'network-block', endpoint: delayMs ? 'modrinth' : 'other', controlledWaitMs: delayMs });
    if (delayMs) setTimeout(() => callback({ cancel: true }), delayMs); else callback({ cancel: true });
  });
});
app.on('browser-window-created', (_event, window) => {
  let timer;
  window.webContents.once('did-finish-load', () => {
    let busy = false;
    timer = setInterval(() => {
      if (busy || window.isDestroyed()) return; busy = true;
      void window.webContents.executeJavaScript(`(async()=>{
        const a='40000000-0000-4000-8000-000000000002',b='40000000-0000-4000-8000-000000000003';
        const selected=()=>document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id');
        const active=t=>t.kind==='mod-check'&&['queued','running','verifying','committing','pausing','cancelling','failing'].includes(t.state);
        const startedAt=new Date().toISOString(),beforeSelected=selected();
        if(!window.oucl)return {verdict:'NO_BRIDGE',startedAt};
        const aTargets=await window.oucl.listInstanceTaskTargets({instanceId:a,kinds:['mod-check'],limit:100});
        const candidate=aTargets.ok?aTargets.data.items.find(row=>row.instanceId===a&&active(row.task)):null;
        const activeBefore=candidate?await window.oucl.getTask(candidate.task.taskId):null;
        const bTargets=await window.oucl.listInstanceTaskTargets({instanceId:b,kinds:['mod-check'],limit:100});
        const activeAfter=candidate?await window.oucl.getTask(candidate.task.taskId):null;
        const afterSelected=selected(),reportInstance=document.querySelector('.mod-report')?.getAttribute('data-instance-id');
        const taskId=candidate?.task.taskId;
        const proven=aTargets.ok&&!aTargets.data.nextCursor&&aTargets.data.items.every(row=>row.instanceId===a)
          &&bTargets.ok&&!bTargets.data.nextCursor&&bTargets.data.items.every(row=>row.instanceId===b)
          &&activeBefore?.ok&&activeAfter?.ok&&activeBefore.data.snapshot.taskId===taskId&&activeAfter.data.snapshot.taskId===taskId
          &&active(activeBefore.data.snapshot)&&active(activeAfter.data.snapshot)
          &&activeAfter.data.snapshot.revision>=activeBefore.data.snapshot.revision
          &&!bTargets.data.items.some(row=>row.task.taskId===taskId);
        return {verdict:beforeSelected===b&&afterSelected===b&&reportInstance===b&&proven?'BRACKETED_WITNESS':'NOT_COVERED',
          startedAt,finishedAt:new Date().toISOString(),beforeSelected,afterSelected,reportInstance,taskId,
          aTargets,activeBefore,bTargets,activeAfter,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined',
          modPanel:document.querySelector('.mods-panel')?.textContent};
      })()`).then(value => record({ kind: 'target-proof', value })).catch(error => record({ kind: 'harness-error', code: error.name }))
        .finally(() => { busy = false; });
    }, 1000);
    record({ kind: 'loaded', profile: 'existing-v4-bc-profile', source: 'unchanged-v4-bc-product' });
  });
  window.once('closed', () => { clearInterval(timer); record({ kind: 'window-closed' }); });
});
app.on('will-quit', () => record({ kind: 'will-quit' })); process.on('exit', code => record({ kind: 'exit', code }));
require(path.join(base, 'product/main/index.cjs'));
