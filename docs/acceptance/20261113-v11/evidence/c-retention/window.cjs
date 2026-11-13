// Coordinator GUI harness: same v3 product, real 15-minute clock; no domain/bridge replacement.
const {app,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,fixture=path.resolve(base,'../v4-bc');
const seed=JSON.parse(fs.readFileSync(path.join(fixture,'seed.json'),'utf8'));
const product=path.resolve(base,'../product');
const manifest=JSON.parse(fs.readFileSync(path.resolve(base,'../product-manifest.json'),'utf8'));
for(const item of manifest){if(crypto.createHash('sha256').update(fs.readFileSync(path.join(product,item.path))).digest('hex')!==item.sha256)throw Error('PRODUCT_CHANGED');}
fs.writeFileSync(path.join(base,'verified-product.json'),JSON.stringify(manifest,null,2));
const record=value=>fs.appendFileSync(path.join(base,'window.jsonl'),JSON.stringify({time:new Date().toISOString(),monoMs:performance.now(),...value})+'\n');
app.setPath('userData',seed.profile);app.disableHardwareAcceleration();delete process.env.OUCL_PORTABLE_ROOT;
let ownedWindow,first,retentionTimer,domTimer;
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>originalHandle(channel,async(event,input)=>{
  const result=await handler(event,input);
  if(!channel.startsWith('mods:maintenancePreview'))return result;
  record({kind:'preview-public',channel,requestId:input?.requestId,input:input?.payload,result});
  if(channel==='mods:maintenancePreview'&&result?.ok&&!first) first={requestId:input.requestId,input:input.payload,previewId:result.data.previewId};
  if(channel==='mods:maintenancePreviewStatus'&&result?.ok&&result.data.status==='completed'&&first?.previewId===result.data.previewId&&!retentionTimer){
    first.completedObservedMono=performance.now();first.completedObservedAt=new Date().toISOString();
    fs.writeFileSync(path.join(base,'first-completed.json'),JSON.stringify(first,null,2));
    retentionTimer=setTimeout(async()=>{
      if(!ownedWindow||ownedWindow.isDestroyed()){record({kind:'retention-incomplete',reason:'window-destroyed'});return;}
      try{
        const result=await ownedWindow.webContents.executeJavaScript(`(async()=>{
          const first=${JSON.stringify(first)};
          const oldStatus=await window.oucl.maintenancePreviewStatus(first.previewId);
          const oldAdmission=await window.oucl.maintenancePreview(first.requestId,first.input);
          return {oldStatus,oldAdmission,selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),previewText:document.querySelector('.mods-panel')?.textContent};
        })()`);
        const proof={elapsedMs:performance.now()-first.completedObservedMono,first,...result};
        fs.writeFileSync(path.join(base,'retention-proof.json'),JSON.stringify(proof,null,2));record({kind:'retention-proof',...proof});
      }catch(error){record({kind:'retention-error',errorName:error.name});}
    },900500);
  }
  return result;
});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
app.on('browser-window-created',(_event,window)=>{
  ownedWindow=window;window.once('ready-to-show',()=>{window.unmaximize();window.setBounds({x:100,y:100,width:1180,height:820});});
  window.webContents.once('did-finish-load',()=>{
    const p=window.webContents.getLastWebPreferences();record({kind:'loaded',security:{contextIsolation:p.contextIsolation,sandbox:p.sandbox,nodeIntegration:p.nodeIntegration}});
    let previous='',busy=false;domTimer=setInterval(()=>{
      if(busy||window.isDestroyed())return;busy=true;
      window.webContents.executeJavaScript(`({selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),panel:document.querySelector('.mods-panel')?.textContent,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'})`)
        .then(value=>{const text=JSON.stringify(value);if(text!==previous){previous=text;record({kind:'dom',value});}})
        .catch(error=>record({kind:'dom-error',errorName:error.name})).finally(()=>{busy=false;});
    },1000);
  });
  window.once('closed',()=>{clearTimeout(retentionTimer);clearInterval(domTimer);record({kind:'window-closed'});});
});
app.on('will-quit',()=>record({kind:'will-quit'}));process.on('exit',code=>record({kind:'exit',code}));
require(path.join(product,'main/index.cjs'));
