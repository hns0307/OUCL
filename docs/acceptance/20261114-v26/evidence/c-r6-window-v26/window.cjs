// Approved synthetic transport substitute only; actual desktop fetch/client/worker/IPC/React unchanged.
const {app,session,ipcMain,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,seed=JSON.parse(fs.readFileSync(path.join(base,'seed.json'),'utf8'));
if(fs.existsSync(path.join(base,'window.jsonl')))throw Error('EXISTING_EVIDENCE_PRESERVED');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'product-manifest.json'),'utf8'));
for(const item of manifest)if(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'product',item.path))).digest('hex')!==item.sha256)throw Error('PRODUCT_CHANGED');
fs.writeFileSync(path.join(base,'verified-product.json'),JSON.stringify(manifest,null,2));
const record=value=>fs.appendFileSync(path.join(base,'window.jsonl'),JSON.stringify({time:new Date().toISOString(),monoMs:performance.now(),...value})+'\n');
net.request=require('./transport.cjs').createFactory(()=>JSON.parse(fs.readFileSync(path.join(base,'whitelist.json'),'utf8')),record);
app.setPath('userData',seed.profile);app.disableHardwareAcceleration();delete process.env.OUCL_PORTABLE_ROOT;
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>handle(channel,async(event,input)=>{
  if(channel.startsWith('mods:maintenancePreview'))record({kind:'ipc-received',channel,requestId:input?.requestId,input:input?.payload});
  const result=await handler(event,input);
  if(channel.startsWith('mods:maintenancePreview'))record({kind:'ipc-returned',channel,requestId:input?.requestId,result});return result;
});
let timer;
app.on('browser-window-created',(_event,window)=>{
  window.once('ready-to-show',()=>{window.unmaximize();window.setBounds({x:100,y:100,width:1180,height:820});});
  window.webContents.once('did-finish-load',()=>{
    record({kind:'loaded',transport:'Strict synthetic EventEmitter request/Readable response; NOT HTTP/public network'});
    let busy=false,previous='';timer=setInterval(()=>{
      if(busy||window.isDestroyed())return;busy=true;
      window.webContents.executeJavaScript(`({selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),reportInstance:document.querySelector('.mod-report')?.getAttribute('data-instance-id'),panel:document.querySelector('.mods-panel')?.textContent,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'})`)
      .then(value=>{const text=JSON.stringify(value);if(text!==previous){previous=text;record({kind:'dom',value});}})
      .catch(()=>record({kind:'dom-error'})).finally(()=>{busy=false;});},500);
  });
  window.once('closed',()=>{clearInterval(timer);record({kind:'window-closed'});});
});
app.on('before-quit',()=>clearInterval(timer));app.on('will-quit',()=>record({kind:'will-quit'}));process.on('exit',code=>record({kind:'exit',code}));
require(path.join(base,'product/main/index.cjs'));
