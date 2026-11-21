// Diagnostic only: original requests/results, immediate fail-closed network. Coordinator launches GUI.
const {app,session,ipcMain,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname, product=path.resolve(base,'../product');
if(fs.existsSync(path.join(base,'window.jsonl')))throw Error('EXISTING_EVIDENCE_PRESERVED');
const seed=JSON.parse(fs.readFileSync(path.resolve(base,'../v4-bc/seed.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.resolve(base,'../product-manifest.json'),'utf8'));
for(const item of manifest)if(crypto.createHash('sha256').update(fs.readFileSync(path.join(product,item.path))).digest('hex')!==item.sha256)throw Error('PRODUCT_CHANGED');
fs.writeFileSync(path.join(base,'verified-product.json'),JSON.stringify(manifest,null,2));
const record=value=>fs.appendFileSync(path.join(base,'window.jsonl'),JSON.stringify({time:new Date().toISOString(),monoMs:performance.now(),...value})+'\n');
const endpoint=url=>url==='https://api.modrinth.com/v2/version_files'?'version_files':'other';
const requests=[];let heldRequest,seq=0,domTimer;
function safeError(error){
  const message=String(error?.message||'');
  const code=typeof error?.code==='string'&&/^(?:ERR_|E)[A-Z0-9_]{1,60}$/.test(error.code)?error.code:null;
  const token=message.match(/\b(?:net::)?(ERR_[A-Z0-9_]{1,60})\b/)?.[1]||null;
  return {code,netToken:token,category:/ERR_BLOCKED_BY_CLIENT/.test(message)?'blocked-by-client':/ERR_ABORTED/.test(message)?'aborted':/CERT_|SSL_/.test(message)?'certificate-or-tls':/PROXY_/.test(message)?'proxy':/ERR_FAILED/.test(message)?'generic-network-failed':'unknown'};
}
app.setPath('userData',seed.profile);app.disableHardwareAcceleration();delete process.env.OUCL_PORTABLE_ROOT;
const originalRequest=net.request.bind(net);
net.request=function(...args){
  const request=originalRequest(...args), options=args[0];
  const url=typeof options==='string'?options:options?.url;
  if(endpoint(url)!=='version_files')return request;
  const observed={id:++seq,closed:false,aborted:false};requests.push(observed);
  if(!heldRequest)heldRequest=observed;
  record({kind:'request-created',request:observed.id,endpoint:'version_files',method:typeof options==='object'?options.method:null,
    explicitSession:!!options?.session,explicitPartition:!!options?.partition,association:'Creation order only; not a measured Chromium request-id mapping.'});
  const abort=request.abort;
  request.abort=function(...values){observed.aborted=true;record({kind:'request-abort-called',request:observed.id});return abort.apply(this,values);};
  request.once('finish',()=>record({kind:'request-finish',request:observed.id}));
  request.once('close',()=>{observed.closed=true;record({kind:'request-close',request:observed.id});});
  request.once('abort',()=>{observed.aborted=true;record({kind:'request-abort-event',request:observed.id});});
  request.once('error',error=>record({kind:'request-error',request:observed.id,...safeError(error)}));
  request.once('response',response=>record({kind:'unexpected-response',request:observed.id,status:response.statusCode}));
  return request;
};
app.whenReady().then(()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{
    const isTarget=endpoint(details.url)==='version_files', latest=requests.at(-1);
    const guards={target:isTarget,notHeldYet:true,hasHeldRequest:!!heldRequest,notAborted:!!heldRequest&&!heldRequest.aborted,notClosed:!!heldRequest&&!heldRequest.closed};
    const wouldHold=Object.values(guards).every(Boolean);
    record({kind:'interception',interceptionId:details.id,endpoint:endpoint(details.url),method:details.method,
      guards,wouldHoldUnderOldGuard:wouldHold,heldRequest:heldRequest?{...heldRequest}:null,latestRequest:latest?{...latest}:null,
      requestAssociation:'Candidates by creation order, NOT verified identity',policy:'diagnostic-immediate-reject'});
    let called=false;
    const onceCancel=()=>{if(called){record({kind:'callback-duplicate-attempt',interceptionId:details.id});return;}called=true;
      record({kind:'callback-invoked',interceptionId:details.id,cancel:true});
      try{callback({cancel:true});record({kind:'callback-returned',interceptionId:details.id});}
      catch(error){record({kind:'callback-error',interceptionId:details.id,...safeError(error)});}};
    onceCancel(); // Never holds a closed object or sends any request outside the machine.
  });
});
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>handle(channel,async(event,input)=>{
  if(channel.startsWith('mods:maintenancePreview'))record({kind:'ipc-received',channel,requestId:input?.requestId,input:input?.payload});
  const result=await handler(event,input);
  if(channel.startsWith('mods:maintenancePreview'))record({kind:'ipc-returned',channel,requestId:input?.requestId,result});
  return result;
});
app.on('browser-window-created',(_event,window)=>{
  window.once('ready-to-show',()=>{window.unmaximize();window.setBounds({x:100,y:100,width:1180,height:820});});
  window.webContents.once('did-finish-load',()=>{
    record({kind:'loaded'});let busy=false,previous='';
    domTimer=setInterval(()=>{if(busy||window.isDestroyed())return;busy=true;
      window.webContents.executeJavaScript(`({selected:document.querySelector('.instance-item[aria-pressed="true"]')?.getAttribute('data-instance-id'),panel:document.querySelector('.mods-panel')?.textContent,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'})`)
      .then(value=>{const text=JSON.stringify(value);if(text!==previous){previous=text;record({kind:'dom',value});}})
      .catch(()=>record({kind:'dom-error'})).finally(()=>{busy=false;});},500);
  });
  window.once('closed',()=>{clearInterval(domTimer);record({kind:'window-closed'});});
});
app.on('before-quit',()=>clearInterval(domTimer));app.on('will-quit',()=>record({kind:'will-quit'}));process.on('exit',code=>record({kind:'exit',code}));
require(path.join(product,'main/index.cjs'));
