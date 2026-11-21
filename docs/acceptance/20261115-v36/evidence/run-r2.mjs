import {spawn} from 'node:child_process';
import {writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));const log=await open(path.join(base,'run-r2.log'),'wx');
const child=spawn('D:/MC_start/OUCL-remediation-20261114-r1/node_modules/electron/dist/electron.exe',[path.join(base,'probe-r2.cjs')],{windowsHide:true,stdio:['ignore',log.fd,log.fd]});
child.on('error',error=>{throw error;});child.on('exit',async(code,signal)=>{await log.close();await writeFile(path.join(base,'process-exit-r2.json'),JSON.stringify({code,signal,scope:'own headless diagnostic, no BrowserWindow'},null,2)+'\n');process.exitCode=code??1;console.log('headless diagnostic exit='+code);});
