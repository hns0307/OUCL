import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SourceTransfer } from '../.test-build/src/services/download/source-transfer.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../.test-build/src/shared/contracts/download-preferences.js';
import { OfficialMetadataReader, MANIFEST_URL } from '../.test-build/src/services/catalog/transport.js';
import { sourceKey } from '../.test-build/src/services/objects/provenance.js';
const evidence=path.resolve('docs/validation/DOWNLOADS-main');await mkdir(evidence,{recursive:true});
const root=await mkdtemp(path.resolve('.test-build/download-network-'));
const report={status:'RUNNING',root,samples:[]};
try {
  const reader=new OfficialMetadataReader();const manifest=JSON.parse((await reader.read(MANIFEST_URL)).body);
  const version=manifest.versions.find(item=>item.id==='1.20.1');assert.ok(version);
  const descriptor=JSON.parse((await reader.read(version.url,version.sha1)).body);
  const library=descriptor.libraries.find(item=>item.name==='com.google.guava:guava:31.1-jre')?.downloads.artifact;assert.ok(library);
  for(const [label,artifact,source,connections] of [['official-parallel',descriptor.downloads.client,'official',4],['official-serial',descriptor.downloads.client,'official',1],['bmclapi',library,'bmclapi',4]]) {
    const expected={algorithm:'sha1',digest:artifact.sha1,size:artifact.size,provenanceId:`network:${label}`};const anchor={kind:'mojang-version',algorithm:'sha1',digest:version.sha1};
    let record={url:artifact.url,expected,anchor,key:sourceKey(expected,anchor),stagingId:'00000000-0000-4000-8000-000000000001',revision:1,bytesDone:0,state:'partial'};
    const file=path.join(root,label+'.part');await writeFile(file,'');let active=0;let peak=0;const requests=[];
    const request=async(input,init)=>{
      active++;peak=Math.max(peak,active);let response;
      try {response=await fetch(input,init);requests.push({url:String(input),range:new globalThis.Headers(init?.headers).get('range'),status:response.status,etag:response.headers.get('etag'),location:response.headers.get('location')});}
      catch(error){active--;throw error;}
      if(!response.body){active--;return response;}
      const original=response.body.getReader();let ended=false;const end=()=>{if(!ended){ended=true;active--;}};
      return new globalThis.Response(new globalThis.ReadableStream({async pull(controller){try{const value=await original.read();if(value.done){end();controller.close();}else controller.enqueue(value.value);}catch(error){end();controller.error(error);}},async cancel(){try{await original.cancel();}finally{end();}}}),{status:response.status,headers:response.headers});
    };
    const start=Date.now();console.log('VERIFY',label);
    await new SourceTransfer(()=>({...DEFAULT_DOWNLOAD_PREFERENCES,source,connectionsPerFile:connections}),request).run(file,record,async(revision,next)=>{assert.equal(revision,record.revision);record=next;});
    const bytes=await readFile(file);assert.equal(bytes.length,artifact.size);assert.equal(createHash('sha1').update(bytes).digest('hex'),artifact.sha1);assert.equal(active,0);
    report.samples.push({label,bytes:bytes.length,elapsedMs:Date.now()-start,peak,transportSource:record.transportSource??'official',independentSha1:true,requests});
    if(label==='official-parallel') report.officialParallelObserved=peak>=2;
    if(label==='bmclapi')assert.equal(record.transportSource,'bmclapi','MIRROR_FELL_BACK_OFFICIAL');
    await writeFile(path.join(evidence,'network.json'),JSON.stringify(report,null,2));console.log(label,peak,Date.now()-start);
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.code??error.message;throw error;}
finally{await writeFile(path.join(evidence,'network.json'),JSON.stringify(report,null,2));}


