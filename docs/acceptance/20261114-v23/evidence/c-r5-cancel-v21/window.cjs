// C-R3: hold one actual completed status and one actual completed cancel receipt.
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
let first, sequence=0, closing=false, domTimer; const pending=new Map(); let heldStatus=false,heldCancel=false;
function release(invocation,reason){const h=pending.get(invocation);if(!h)return;pending.delete(invocation);clearTimeout(h.timer);record({kind:'delivered',invocation,channel:h.channel,requestId:h.input.requestId,previewId:h.input.payload.previewId,result:h.result,reason,elapsedMs:performance.now()-h.handledMono});h.resolve(h.result);}
function drain(reason){closing=true;clearInterval(domTimer);for(const id of [...pending.keys()])release(id,reason);}
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>originalHandle(channel,async(event,input)=>{
 const invocation=++sequence;const result=await handler(event,input);
 if(!channel.startsWith('mods:maintenancePreview'))return result;
 const handledMono=performance.now();record({kind:'handled',invocation,channel,input,result,senderId:event.sender.id,frameUrl:event.senderFrame?.url,isMainFrame:event.senderFrame===event.sender.mainFrame});
 if(channel==='mods:maintenancePreview'&&result?.ok){if(!first){first={requestId:input.requestId,previewId:result.data.previewId,input:input.payload};fs.writeFileSync(path.join(base,'first-admission.json'),JSON.stringify(first,null,2));}else record({kind:'additional-admission',input,result});}
 const same=first&&input?.payload?.previewId===first.previewId;
 let hold=false;
 if(!closing&&same&&channel==='mods:maintenancePreviewStatus'&&result?.ok&&result.data.status==='completed'&&!heldStatus){heldStatus=true;hold=true;}
 if(!closing&&same&&channel==='mods:maintenancePreviewCancel'&&!heldCancel){heldCancel=true;if(result?.ok&&result.data.status==='completed')hold=true;else record({kind:'cancel-completion-precondition-not-met',result});}
 if(hold)return await new Promise(resolve=>{const delay=channel==='mods:maintenancePreviewCancel'?2500:8000;const timer=setTimeout(()=>release(invocation,'real-'+delay+'ms-receipt-delay'),delay);pending.set(invocation,{timer,resolve,result,input,channel,handledMono});record({kind:'held',invocation,channel,input,result,waitMs:channel==='mods:maintenancePreviewCancel'?2500:8000});});
 record({kind:'delivered',invocation,channel,input,result,reason:'immediate-original-result'});return result;
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
