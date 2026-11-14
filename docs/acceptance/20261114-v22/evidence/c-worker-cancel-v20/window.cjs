const {app,session,ipcMain}=require('electron');
const threads=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,product=path.resolve(base,'../product');
if(fs.existsSync(path.join(base,'window.jsonl')))throw Error('EXISTING_RUN_PRESERVED');
const seed=JSON.parse(fs.readFileSync(path.resolve(base,'../v4-bc/seed.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.resolve(base,'../product-manifest.json'),'utf8'));
for(const item of manifest)if(crypto.createHash('sha256').update(fs.readFileSync(path.join(product,item.path))).digest('hex')!==item.sha256)throw Error('PRODUCT_CHANGED');
fs.writeFileSync(path.join(base,'verified-product.json'),JSON.stringify(manifest,null,2));
const record=value=>fs.appendFileSync(path.join(base,'window.jsonl'),JSON.stringify({time:new Date().toISOString(),monoMs:performance.now(),...value})+'\n');
const OriginalWorker=threads.Worker;let selected=false,domTimer;
class ObservedWorker extends OriginalWorker{
  constructor(filename,options){
    const inject=!selected&&options?.workerData?.kind==='mod-archive';
    if(inject)selected=true;
    const effective=inject?{...options,execArgv:[...(options.execArgv??process.execArgv),'--require',path.join(base,'keepalive.cjs')],
      env:{...process.env,OUCL_TEST_KEEPALIVE_LOG:path.join(base,'worker-private.jsonl')}}:options;
    super(filename,effective);
    if(!inject)return;
    const id=this.threadId;record({kind:'worker-selected',threadId:id,entryUnchanged:true,workerDataUnchanged:true,execArgv:effective.execArgv});
    this.on('message',message=>record({kind:'original-worker-message-observed',threadId:id,protocolKind:message?.kind,
      validResultShape:!!message?.result,meaning:'Original parentPort message observed; not generated or changed by harness.'}));
    this.once('online',()=>record({kind:'worker-online',threadId:id}));
    this.once('error',error=>record({kind:'worker-error',threadId:id,errorName:error.name,code:typeof error.code==='string'?error.code:null}));
    this.once('exit',code=>record({kind:'worker-exit',threadId:id,code}));
    const terminate=this.terminate;
    this.terminate=function(...args){record({kind:'original-reader-terminate-called',threadId:id,
      meaning:'Delegates actual terminate unchanged; harness never initiates termination.'});return terminate.apply(this,args);};
  }
}
threads.Worker=ObservedWorker;
if(threads.Worker!==ObservedWorker)throw Error('WORKER_OBSERVATION_INSTALL_FAILED');
app.setPath('userData',seed.profile);app.disableHardwareAcceleration();delete process.env.OUCL_PORTABLE_ROOT;
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>handle(channel,async(event,input)=>{
  if(channel.startsWith('mods:maintenancePreview'))record({kind:'ipc-received',channel,requestId:input?.requestId,input:input?.payload});
  const result=await handler(event,input);
  if(channel.startsWith('mods:maintenancePreview'))record({kind:'ipc-returned',channel,requestId:input?.requestId,result});return result;
});
app.on('browser-window-created',(_event,window)=>{
  window.once('ready-to-show',()=>{window.unmaximize();window.setBounds({x:100,y:100,width:1180,height:820});});
  window.webContents.once('did-finish-load',()=>{
    record({kind:'loaded'});let busy=false,previous='';
    domTimer=setInterval(()=>{if(busy||window.isDestroyed())return;busy=true;
      window.webContents.executeJavaScript(`({selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),panel:document.querySelector('.mods-panel')?.textContent,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'})`)
      .then(value=>{const text=JSON.stringify(value);if(text!==previous){previous=text;record({kind:'dom',value});}})
      .catch(()=>record({kind:'dom-error'})).finally(()=>{busy=false;});},250);
  });
  window.once('closed',()=>{clearInterval(domTimer);record({kind:'window-closed'});});
});
app.on('before-quit',()=>clearInterval(domTimer));app.on('will-quit',()=>record({kind:'will-quit'}));process.on('exit',code=>record({kind:'exit',code}));
require(path.join(product,'main/index.cjs'));
