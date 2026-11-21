import { mkdir, writeFile } from 'node:fs/promises';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { LoaderMetadataClient,isOfficialLoaderMetadataUrl } from '../.test-build/src/services/loaders/metadata.js';
import { LoaderMavenResolver } from '../.test-build/src/services/loaders/maven.js';
const evidence=process.env.OUCL_VALIDATION_DIR ?? 'docs/validation/LOADERS-NETWORK-20261026';await mkdir(evidence,{recursive:true});
const observations=[];
const request=async(input,init)=>{try{const response=await fetch(input,init);observations.push({url:String(input),method:init?.method??'GET',status:response.status,length:response.headers.get('content-length'),encoding:response.headers.get('content-encoding'),location:response.headers.get('location')});return response;}catch(error){observations.push({url:String(input),method:init?.method??'GET',error:error.cause?.code??error.code??error.name});throw error;}};
const client=new LoaderMetadataClient(new OfficialMetadataReader(request,isOfficialLoaderMetadataUrl));
const results=[];
for(const [kind,version] of [['fabric','0.16.14'],['quilt','0.29.2']]){
 let stage='profile';try{const profile=await client.profile(kind,'1.20.1',version);stage='maven';const plan=await new LoaderMavenResolver(request, Number(process.env.OUCL_LOADER_PROOF_CONCURRENCY ?? 4)).plan(profile.profile,profile.evidence);results.push({kind,version,status:'PASS',libraries:plan.libraries.length,totalBytes:plan.totalBytes});}
 catch(error){results.push({kind,version,status:'FAIL',stage,code:error.code??error.name});}
}
if(results.some(result=>result.status!=='PASS'))process.exitCode=1;
await writeFile(`${evidence}/probe.json`,JSON.stringify({results,observations},null,2));console.log(JSON.stringify({results,observations},null,2));

