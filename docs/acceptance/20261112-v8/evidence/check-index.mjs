import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const cwd='C:/Users/Administrator/.codex/worktrees/oucl-acceptance-20261111/OUCL';
const git=args=>{const result=spawnSync('git',args,{cwd,windowsHide:true,maxBuffer:10*1024*1024});assert.equal(result.status,0);return result.stdout;};
const paths=git(['diff','--cached','--name-only','-z']).toString().split('\0').filter(Boolean);
const normalized=[];
for(const file of paths){
  assert.match(file,/^(docs\/acceptance\/|OUCL-Codex\/docs\/(TASK_PLAN|DECISIONS)\.md$)/);
  const source=await readFile(path.join('D:/MC_start/OUCL',file));const staged=git(['show',`:${file}`]);
  if(source.equals(staged))continue;
  assert.ok(!/20261112-v[4-7]\/evidence\//.test(file),`RAW_EVIDENCE_CHANGED:${file}`);
  assert.equal(source.toString().replace(/\r\n/g,'\n'),staged.toString(),`CONTENT_CHANGED:${file}`);normalized.push(file);
}
const result={status:'PASS',stagedFiles:paths.length,substantiveDifferences:[],rawEvidenceExact:true,crlfToLf:normalized};
await writeFile('acceptance-results/v6-package/index-content-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
