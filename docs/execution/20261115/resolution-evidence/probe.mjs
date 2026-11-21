import { mkdir,writeFile,link,unlink } from 'node:fs/promises';
import http from 'node:http';
const root='D:/MC_start/OUCL/tmp/baseline-resolution-20261115';
await mkdir(root,{recursive:true});
const result={node:process.version,platform:process.platform};
await writeFile(root+'/probe-source.txt','isolated link probe');
try{await link(root+'/probe-source.txt',root+'/probe-link.txt');result.link='PASS';await unlink(root+'/probe-link.txt');}catch(e){result.link={code:e.code,syscall:e.syscall};}
const server=http.createServer((_req,res)=>res.end('isolated loopback probe'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{const response=await fetch('http://127.0.0.1:'+server.address().port,{signal:AbortSignal.timeout(3000)});result.loopback={status:response.status,body:await response.text()};}catch(e){result.loopback={code:e.cause?.code,message:e.cause?.message??e.message};}
await new Promise(r=>server.close(r)); console.log(JSON.stringify(result,null,2));
