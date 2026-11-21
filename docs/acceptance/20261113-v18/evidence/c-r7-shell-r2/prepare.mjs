import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory=path.resolve('acceptance-results/c-r7-shell-r2');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const products=JSON.parse(await readFile('acceptance-results/product-manifest.json','utf8'));
assert.equal(products.length,7);
for(const item of products){const file=path.resolve('dist',item.path);assert.ok(!(await lstat(file)).isSymbolicLink());assert.equal(sha(await readFile(file)),item.sha256,file);}
const freeze=JSON.parse(await readFile('FREEZE-MANIFEST.json','utf8'));
for(const item of freeze.files)assert.equal(sha(await readFile(item.path)),item.sha256,item.path);
const scripts=['harness.cjs','test-preload.cjs','prepare.mjs'];
const syntax=[];
for(const file of scripts){const check=spawnSync(process.execPath,['--check',path.join(directory,file)],{encoding:'utf8'});syntax.push({file,status:check.status,output:check.stdout+check.stderr});assert.equal(check.status,0,JSON.stringify(syntax));}
const inputs={};
for(const file of [...scripts,'untrusted.html','harness-app/package.json'])inputs[file]=sha(await readFile(path.join(directory,file)));
await writeFile(path.join(directory,'preparation.json'),JSON.stringify({status:'PREPARED_NOT_RUN',electronStarted:false,syntax,productFilesChecked:products.length,frozenInputsChecked:freeze.files.length,products,harnessInputs:inputs,
  pending:['All real Electron execution/results','Subframe IPC under unchanged production preferences','Direct inventory scan invocation counter','Wrong previewId or path/URL response mutation']},null,2));
console.log(`PREPARED_NOT_RUN: ${scripts.length} syntax checks; ${products.length} product pins; ${freeze.files.length} source pins; no Electron launch.`);
