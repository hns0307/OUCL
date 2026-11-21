import {build} from 'file:///D:/MC_start/OUCL/node_modules/esbuild/lib/main.js';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root='D:/MC_start/OUCL/tmp/execution-adapter-20261117-c';
const evidence='docs/execution/20261117-c/adapter-evidence';mkdirSync(evidence,{recursive:true});
await build({entryPoints:['tests/distribution-execution-adapter.test.ts','tests/distribution-execution-owners.test.ts','tests/distribution-execution-contract.test.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outdir:root,outExtension:{'.js':'.mjs'}});
const results={};
for(const [name,args] of [
 ['test',['--test',root+'/distribution-execution-adapter.test.mjs',root+'/distribution-execution-owners.test.mjs',root+'/distribution-execution-contract.test.mjs']],
 ['typecheck',['D:/MC_start/OUCL/node_modules/typescript/bin/tsc','--noEmit']],
 ['lint',['D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js','src/ipc/distribution-execution.ts','src/ipc/distribution-execution-owners.ts','tests/distribution-execution-adapter.test.ts','tests/distribution-execution-owners.test.ts']]
]) {const fd=openSync(evidence+'/'+name+'-initial.log','w');const r=spawnSync(process.execPath,args,{env:{...process.env,OUCL_TEST_ROOT:root},stdio:['ignore',fd,fd]});closeSync(fd);results[name]={status:r.status,signal:r.signal,error:r.error?.message};}
writeFileSync(evidence+'/initial-status.json',JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(results));
