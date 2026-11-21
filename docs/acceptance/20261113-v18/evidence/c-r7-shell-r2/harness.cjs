// Prepared only. Coordinator launches this via harness-app using CUA.
const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const workerThreads=require('node:worker_threads');
const base=path.resolve(__dirname,'../..');
const product=path.join(base,'dist');
const runtime=path.join(__dirname,'runtime');
const entry=path.join(product,'renderer/index.html');
const entryUrl=require('node:url').pathToFileURL(entry).href;
const channels=['mods:maintenancePreview','mods:maintenancePreviewStatus','mods:maintenancePreviewCancel'];
const originalHandle=ipcMain.handle;
const OriginalWorker=workerThreads.Worker;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(path.resolve(app.getAppPath())!==path.join(__dirname,'harness-app')) throw Error('LAUNCH_HARNESS_APP_DIRECTORY');
if(fs.existsSync(runtime)) throw Error('FRESH_RUNTIME_REQUIRED_NO_REUSE');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'acceptance-results/product-manifest.json'),'utf8'));
if(manifest.length!==7) throw Error('EXPECTED_SEVEN_PRODUCTS');
for(const item of manifest) {
  const target=path.resolve(product,item.path); const relative=path.relative(product,target);
  if(relative.startsWith('..')||path.isAbsolute(relative)||fs.lstatSync(target).isSymbolicLink()||sha(fs.readFileSync(target))!==item.sha256) throw Error('PRODUCT_PIN_FAILED');
}
fs.mkdirSync(runtime); const profile=path.join(runtime,'profile'); fs.mkdirSync(profile);
app.setPath('userData',profile); app.setPath('sessionData',profile);
process.env.OUCL_PORTABLE_ROOT=runtime;
const events=path.join(runtime,'events.jsonl');
let sequence=0,archiveWorkers=0,validStartsReturned=0; let primary; let fault; let faultApplied=false; let completedFault=false;
const observations=[]; const reports=[];
const log=(kind,fields={})=>fs.appendFileSync(events,JSON.stringify({sequence:sequence++,time:new Date().toISOString(),kind,...fields})+'\n');
function frameIdentity(event) {
  return {senderId:event.sender.id,frameUrl:event.senderFrame?.url??null,mainUrl:event.sender.mainFrame?.url??null,
    isMainFrame:event.senderFrame===event.sender.mainFrame,frameRoutingId:event.senderFrame?.routingId??null,
    frameProcessId:event.senderFrame?.processId??null,windowId:BrowserWindow.fromWebContents(event.sender)?.id??null,
    primaryWindow:!!primary&&event.sender===primary.webContents};
}
// Harness identification only. Does not change the production sender decision.
function observePrimary(event) {
  if(primary||event.sender.isDestroyed()||event.senderFrame!==event.sender.mainFrame
    ||event.senderFrame?.url!==entryUrl||event.sender.mainFrame?.url!==entryUrl)return;
  const owner=BrowserWindow.fromWebContents(event.sender);
  if(!owner||owner.webContents!==event.sender)return;
  const preferences=event.sender.getLastWebPreferences();
  if(preferences.sandbox!==true||preferences.contextIsolation!==true||preferences.nodeIntegration!==false
    ||preferences.nodeIntegrationInSubFrames===true)throw Error('SECURITY_INVARIANT_CHANGED');
  primary=owner;
  log('primary-observed-from-real-event',{...frameIdentity(event),basis:'exact production entry URL; actual primary frame identity; actual BrowserWindow ownership; secure preferences'});
}
let WorkerProxy;
WorkerProxy=new Proxy(OriginalWorker,{construct(target,args,newTarget){
  const worker=Reflect.construct(target,args,newTarget===WorkerProxy?target:newTarget);
  if(args[1]?.workerData?.kind==='mod-archive') {archiveWorkers++;log('actual-mod-archive-worker',{threadId:worker.threadId});}
  return worker;
}});
workerThreads.Worker=WorkerProxy;
ipcMain.handle=function(channel,handler){
  if(!channels.includes(channel)) return Reflect.apply(originalHandle,this,[channel,handler]);
  return Reflect.apply(originalHandle,this,[channel,async(event,input)=>{
    observePrimary(event);
    const identity=frameIdentity(event);
    const result=await handler(event,input); // Original registered production callback and real event, untouched.
    if(channel===channels[0]&&result?.ok===true)validStartsReturned++;
    const record={channel,requestId:input?.requestId,...identity,ok:result?.ok,code:result?.error?.code??null,archiveWorkers};
    observations.push(record); log('original-handler-return',record);
    if(fault&&channel===channels[1]&&event.sender===primary?.webContents) {
      const consume=fault; fault=undefined;
      if(result?.ok!==false||result?.error?.code!=='PREVIEW_EXPIRED') throw Error('FAULT_REQUIRES_ORIGINAL_EXPIRED_FAILURE');
      const injected={...result,requestId:'00000000-0000-4000-8000-000000000099'};
      log('test-only-response-corruption',{kind:consume,original:result,injected,identity});
      faultApplied=true;
      return injected;
    }
    return result;
  }]);
};
function persist() {
  const trusted=reports.find(r=>r.role==='primary'); const untrusted=reports.find(r=>r.role==='untrusted');
  const issues=[];
  if(trusted)for(const result of trusted.results??[])if(result.reply?.ok!==false||result.reply?.error?.code!=='INVALID_ARGUMENT')issues.push('PRIMARY_REJECTION_MISMATCH');
  if(untrusted)for(const result of untrusted.results??[])if(result.reply?.ok!==false||result.reply?.error?.code!=='INVALID_SENDER')issues.push('UNTRUSTED_REJECTION_MISMATCH');
  if(archiveWorkers!==0||validStartsReturned!==0)issues.push('UNEXPECTED_DOMAIN_ENTRY');
  const complete=trusted?.results?.length===6&&untrusted?.results?.length===3&&completedFault;
  fs.writeFileSync(path.join(runtime,'snapshot.json'),JSON.stringify({state:issues.length?'FAIL':complete?'EXECUTED_CHECKS_COMPLETE':'PENDING',issues,reports,
    archiveWorkers,validStartsReturned,directInventoryScanCounter:'PENDING: internal bundled service is not instrumented',observations,
    nonPrimaryFrame:'PENDING: no subframe IPC capability under unchanged production preferences',
    wrongPreviewIdAndUrlPathResponse:'PENDING: not injected in this minimal shell',productManifest:manifest},null,2));
}
ipcMain.on('c-r7:test-report',(event,report)=>{
  const identity=frameIdentity(event);
  // Accept test reports only from these two actual test windows.
  if(!identity.isMainFrame||!['primary','untrusted'].includes(report?.role)||!Array.isArray(report.results))return;
  if(report.role==='primary'&&(!identity.primaryWindow||identity.frameUrl!==entryUrl))return;
  if(report.role==='untrusted'&&identity.frameUrl!==require('node:url').pathToFileURL(path.join(__dirname,'untrusted.html')).href)return;
  if(reports.some(r=>r.role===report.role))return;
  reports.push({...report,identity});log('test-preload-report',{...report,identity});persist();
  if(report.role==='primary')void (async()=>{
    fault='wrong-requestId-on-original-error';
    try {
      const reply=await primary.webContents.executeJavaScript("window.oucl.maintenancePreviewStatus('00000000-0000-4000-8000-000000000002')",false);
      completedFault=faultApplied&&reply?.ok===false&&reply?.error?.code==='UNAVAILABLE'&&!fault;
      log('production-preload-corruption-result',{reply,rejectedAsUnavailable:completedFault});
    }catch(error){log('production-preload-corruption-error',{errorName:error?.name});}
    persist();
    const outsider=new BrowserWindow({width:720,height:300,title:'C-R7 untrusted boundary',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}});
    outsider.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    outsider.webContents.on('will-navigate',event=>event.preventDefault());
    await outsider.loadFile(path.join(__dirname,'untrusted.html'));
  })().catch(error=>{log('test-sequence-error',{errorName:error?.name});persist();});
});
const installed=new WeakSet();
function blockNetwork(s){if(installed.has(s))return;installed.add(s);s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{log('network-blocked');callback({cancel:true});});}
app.on('session-created',blockNetwork);
app.whenReady().then(()=>{
  blockNetwork(session.defaultSession);
  session.defaultSession.registerPreloadScript({id:'c-r7-restricted-invalid-inputs',type:'frame',filePath:path.join(__dirname,'test-preload.cjs')});
});
app.on('browser-window-created',(_event,window)=>{
  const preferences=window.webContents.getLastWebPreferences();
  log('actual-window-preferences',{windowId:window.id,senderId:window.webContents.id,preferences});
  if(preferences.sandbox!==true||preferences.contextIsolation!==true||preferences.nodeIntegration!==false||preferences.nodeIntegrationInSubFrames===true)throw Error('SECURITY_INVARIANT_CHANGED');
  // preload/preloadScripts may be null in this runtime's preference observation.
  // Do not infer bridge absence or identify the main window from these fields.
});
app.on('will-quit',()=>{persist();log('will-quit');ipcMain.handle=originalHandle;workerThreads.Worker=OriginalWorker;});
process.on('uncaughtExceptionMonitor',error=>log('uncaught-exception',{errorName:error?.name}));
log('preflight',{manifest,independentProfile:true,networkBlocked:true,automaticLegalPreviewStart:false,preparedOnlyUntilCoordinatorLaunch:true});
require(path.join(product,'main/index.cjs'));
