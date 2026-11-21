const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
exports.createFactory=(load,record=()=>{})=>options=>{
  const request=new EventEmitter();let body='',aborted=false,response;
  request.setHeader=()=>{};
  request.write=value=>{body+=String(value);return true;};
  request.abort=()=>{if(aborted)return;aborted=true;response?.destroy();request.emit('abort');request.emit('close');};
  request.end=()=>setImmediate(()=>{
    if(aborted)return;
    const key=hash(body),entry=options.url==='https://api.modrinth.com/v2/version_files'&&options.method==='POST'?load()[key]:null;
    record({kind:'synthetic-transport',matched:!!entry,bodySHA256:key});
    if(!entry){request.emit('error',new Error('TEST_TRANSPORT_REJECTED'));request.emit('close');return;}
    const bytes=Buffer.from(JSON.stringify(entry.body));
    response=new PassThrough();response.statusCode=entry.status;response.headers={'content-type':'application/json','content-length':String(bytes.length)};
    response.once('end',()=>request.emit('close'));request.emit('response',response);response.end(bytes);
  });
  return request;
};
