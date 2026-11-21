import { build } from 'file:///D:/MC_start/OUCL/node_modules/esbuild/lib/main.js';
import { readdir,mkdir,writeFile,readFile } from 'node:fs/promises';
import {spawn} from 'node:child_process';import path from 'node:path';
const source='D:/MC_start/OUCL/本地资料/OUCL-download-main';const root='D:/MC_start/OUCL/tmp/baseline-resolution-20261115';const evidence=source+'/docs/execution/20261115/resolution-evidence';
await mkdir(root+'/tmp',{recursive:true});await mkdir(evidence,{recursive:true});await writeFile(root+'/package.json',JSON.stringify({type:'module'}));
async function files(dir){return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(x=>x.isDirectory()?files(path.join(dir,x.name)):x.name.endsWith('.ts')&&!x.name.endsWith('.d.ts')?[path.join(dir,x.name)]:[]))).flat();}
process.chdir(source);await build({entryPoints:[...await files('src'),...await files('tests')],bundle:false,platform:'node',format:'esm',target:'node24',outbase:'.',outdir:root+'/.test-build'});
const selection=JSON.parse(await readFile(source+'/docs/execution/20261115/baseline-evidence/selection.json','utf8'));const summary=JSON.parse(await readFile(source+'/docs/execution/20261115/evidence/test-summary.json','utf8'));
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const args=['--test','--test-reporter=spec','--test-name-pattern=^('+summary.failures.map(escape).join('|')+')$',...selection.files];
await writeFile(evidence+'/selected-command.json',JSON.stringify({node:process.version,source,root,args,selected:summary.failures},null,2));
const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,OUCL_TEST_ROOT:root,OUCL_SOURCE_ROOT:source,TMP:root+'/tmp',TEMP:root+'/tmp'},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const code=await new Promise(r=>child.on('close',r));await writeFile(evidence+'/selected-unsandboxed.log',output);await writeFile(evidence+'/selected-status.json',JSON.stringify({code,unsandboxed:true},null,2));console.log(output.slice(-5500));console.log('exit='+code);process.exitCode=code;
