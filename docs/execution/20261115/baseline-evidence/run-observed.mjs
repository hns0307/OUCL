import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const evidence='D:/MC_start/OUCL/本地资料/OUCL-download-main/docs/execution/20261115/baseline-evidence';
const log=await readFile('D:/MC_start/OUCL/本地资料/OUCL-download-main/docs/delivery/20261115/recheck-evidence/test.log','utf8');
const failures=log.slice(log.indexOf('✖ failing tests:'));
const names=[...failures.matchAll(/^✖ (.*) \([\d.]+ms\)/gm)].map(x=>x[1]);
const selected=names.filter(x=>!x.startsWith('real process termination'));
const files=[...new Set([...failures.matchAll(/^test at (.test-build\\tests\\[^:]+):/gm)].map(x=>x[1]))];
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const root='D:/MC_start/OUCL/tmp/execution-baseline-20261115';
const args=['--test','--test-reporter=spec','--import','file:///'+root+'/observe.mjs','--test-name-pattern=^('+selected.map(escape).join('|')+')$',...files];
await writeFile(evidence+'/selection.json',JSON.stringify({original:25,selectedCount:selected.length,excluded:names.filter(x=>!selected.includes(x)),files,selected},null,2));
const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,OUCL_TEST_ROOT:root,OUCL_SOURCE_ROOT:'D:/MC_start/OUCL/本地资料/OUCL-download-main',TMP:root+'/tmp',TEMP:root+'/tmp'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
child.on('close',async code=>{await writeFile(evidence+'/observed-repro.log',output);await writeFile(evidence+'/observed-status.json',JSON.stringify({exitCode:code,args},null,2));console.log('exit='+code);console.log(output.slice(-2000));});

