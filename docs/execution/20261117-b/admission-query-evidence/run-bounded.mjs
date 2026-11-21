import { build } from 'file:///D:/MC_start/OUCL/node_modules/esbuild/lib/main.js';
import { mkdirSync,openSync,closeSync,writeFileSync } from 'node:fs';
import {spawnSync} from 'node:child_process';
const root='D:/MC_start/OUCL/tmp/admission-query-20261117-b';
const evidence='docs/execution/20261117-b/admission-query-evidence';
mkdirSync(evidence,{recursive:true});
await build({entryPoints:['tests/distribution-admission-query.test.ts','tests/distribution-admission.test.ts','tests/distribution-store.test.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outdir:root,outExtension:{'.js':'.mjs'}});
const results={};
for(const [name,args] of [
 ['test',['--test',root+'/distribution-admission-query.test.mjs']],
 ['typecheck',['D:/MC_start/OUCL/node_modules/typescript/bin/tsc','--noEmit']],
 ['lint',['D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js','src/services/distribution/admission-record.ts','tests/distribution-admission-query.test.ts']]
]) {
 const out=openSync(evidence+'/'+name+'-bounded.log','w');
 const r=spawnSync(process.execPath,args,{env:{...process.env,OUCL_TEST_ROOT:root},stdio:['ignore',out,out]});closeSync(out);
 results[name]={status:r.status,signal:r.signal,error:r.error?.message};
}
writeFileSync(evidence+'/bounded-status.json',JSON.stringify(results,null,2));
process.stdout.write(JSON.stringify(results));


