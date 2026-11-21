import {mkdir,open,readdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

const source = process.cwd();
const compiled = path.resolve('D:/MC_start/OUCL/tmp/20261118-p-final-tests/.test-build/tests');
const testRoot = path.resolve('D:/MC_start/OUCL/tmp/20261118-p-limited-tests');
const evidence = path.resolve('docs/execution/20261118-p/limited-evidence');
await mkdir(path.join(testRoot,'tmp'), {recursive:true});
await mkdir(evidence, {recursive:true});
const tests = (await readdir(compiled,{recursive:true})).filter(file=>file.endsWith('.test.js'));
const args = ['--test','--test-concurrency=4','--experimental-test-coverage','--test-coverage-include=**/src/core/**/*.js',
  '--test-coverage-lines=85','--test-coverage-branches=85','--test-coverage-functions=85', ...tests.map(file=>path.join(compiled,file))];
const out = await open(path.join(evidence,'tests.log'),'w');
const child = spawn(process.execPath,args,{cwd:testRoot,env:{...process.env, OUCL_SOURCE_ROOT:source, OUCL_TEST_ROOT:testRoot,
  TMP:path.join(testRoot,'tmp'),TEMP:path.join(testRoot,'tmp')},stdio:['ignore',out.fd,out.fd]});
const exitCode = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
await out.close();
await writeFile(path.join(evidence,'status.json'),JSON.stringify({compiled,testRoot,testFiles:tests.length,concurrency:4,exitCode},null,2)+'\n');
process.exitCode = exitCode ?? 1;
