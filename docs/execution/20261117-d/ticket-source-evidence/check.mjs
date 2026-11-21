import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const evidence='docs/execution/20261117-d/ticket-source-evidence';mkdirSync(evidence,{recursive:true});const results={};
for(const [name,args] of [['typecheck',['D:/MC_start/OUCL/node_modules/typescript/bin/tsc','--noEmit']],['lint',['D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js','src/services/distribution/execution.ts']]]){
const fd=openSync(evidence+'/'+name+'-initial.log','w');const r=spawnSync(process.execPath,args,{stdio:['ignore',fd,fd]});closeSync(fd);results[name]={status:r.status,signal:r.signal};}
writeFileSync(evidence+'/initial-status.json',JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(results));
