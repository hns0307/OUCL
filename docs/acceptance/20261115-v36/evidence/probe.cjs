const {app,net,session,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const base=__dirname;app.setPath('userData',path.join(base,'profile'));app.disableHardwareAcceleration();
const trace=[];const record=(kind,fields={})=>{trace.push({time:new Date().toISOString(),monoMs:performance.now(),kind,...fields});};
const bounded=(promise,label)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(label)),5000);Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
function token(error){return String(error?.message??'').match(/\b(ERR_[A-Z0-9_]+)\b/)?.[1]??null;}
async function runCase(mode){
 const tag=randomUUID();const state={mode,closed:false,closeCount:0,finish:false,response:false,responseEnded:false,abort:false,serverReceived:false,serverResponseClosed:false,callbackCount:0,bodyBytes:0};let request;let acknowledgeAbort,acknowledgeServerClose;
 const aborted=new Promise(resolve=>{acknowledgeAbort=resolve;});const serverClosed=new Promise(resolve=>{acknowledgeServerClose=resolve;});
 const server=http.createServer((incoming,response)=>{
  assert.equal(incoming.url,'/'+tag);assert.equal(incoming.method,'POST');incoming.on('data',data=>{state.bodyBytes+=data.length;});
  response.on('close',()=>{state.serverResponseClosed=true;record('server-response-close',{mode,writableEnded:response.writableEnded});acknowledgeServerClose();});
  incoming.on('end',()=>{
   state.serverReceived=true;record('server-body-ended',{mode,clientClosed:state.closed,clientFinish:state.finish,responseSeen:state.response});
   setTimeout(()=>{
    if(mode==='abort'){assert.equal(state.response,false);record('native-abort-called',{mode,clientClosed:state.closed,serverReceived:true});request.abort();}
    else {record('server-response-release',{mode,clientClosed:state.closed});response.writeHead(200,{'Content-Type':'application/json'});response.end('{"ok":true}');}
   },150);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();const url=`http://127.0.0.1:${address.port}/${tag}`;
 const isolated=session.fromPartition('v36-'+tag);
 if(mode==='reject')isolated.webRequest.onBeforeRequest({urls:[url]},(details,callback)=>{assert.equal(details.url,url);assert.equal(details.method,'POST');state.callbackCount++;record('exact-interception',{mode,id:details.id,clientClosed:state.closed,identity:'unique-local-url-and-single-live-request'});callback({cancel:true});});
 try{
  request=net.request({url,method:'POST',session:isolated,useSessionCookies:false,credentials:'omit'});record('request-created',{mode});
  const completion=new Promise((resolve,reject)=>{
   request.on('finish',()=>{state.finish=true;record('client-finish',{mode});});
   request.on('close',()=>{state.closed=true;state.closeCount++;record('client-close',{mode,responseSeen:state.response,serverReceived:state.serverReceived});});
   request.on('abort',()=>{state.abort=true;record('client-abort',{mode});acknowledgeAbort();});
   request.on('error',error=>{state.errorToken=token(error);record('client-error',{mode,netToken:state.errorToken});if(mode==='reject')resolve();else if(mode!=='abort')reject(error);});
   request.on('response',response=>{state.response=true;state.status=response.statusCode;record('client-response',{mode,status:response.statusCode,clientClosed:state.closed});response.on('data',()=>{});response.on('end',()=>{state.responseEnded=true;record('client-response-end',{mode});resolve();});response.on('error',reject);});
  });
  // Rejecting after abort has no response-completion promise; always observe it to avoid unhandled failures.
  completion.catch(()=>{});request.setHeader('Content-Type','application/json');request.write('{"probe":true}');request.end();
  if(mode==='abort'){await bounded(Promise.all([aborted,serverClosed]),'ABORT_NOT_CONFIRMED');assert.equal(state.response,false);assert.equal(state.abort,true);assert.equal(state.serverReceived,true);}
  else if(mode==='reject'){await bounded(completion,'REJECTION_NOT_CONFIRMED');assert.equal(state.errorToken,'ERR_BLOCKED_BY_CLIENT');assert.equal(state.callbackCount,1);assert.equal(state.serverReceived,false);}
  else {await bounded(completion,'RESPONSE_NOT_COMPLETED');assert.equal(state.status,200);assert.equal(state.responseEnded,true);}
  assert.equal(BrowserWindow.getAllWindows().length,0);return state;
 }finally{if(request&&!state.responseEnded&&!state.abort){request.abort();}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(mode==='reject')isolated.webRequest.onBeforeRequest(null);}
}
app.whenReady().then(async()=>{
 let code=0;try{const cases=[];for(const mode of ['response','abort','reject'])cases.push(await runCase(mode));const result={status:'PASS',electron:process.versions.electron,node:process.versions.node,scope:'Headless native Electron net, real HTTP loopback only; not product HTTPS/public-network cancellation',browserWindows:BrowserWindow.getAllWindows().length,cases};fs.writeFileSync(path.join(base,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
 catch(error){code=1;record('probe-failed',{name:error.name,message:error.message.startsWith('ERR_')?error.message:null});console.error(error.name+': '+error.message);}
 finally{fs.writeFileSync(path.join(base,'trace.jsonl'),trace.map(x=>JSON.stringify(x)).join('\n')+'\n');app.exit(code);}
});
