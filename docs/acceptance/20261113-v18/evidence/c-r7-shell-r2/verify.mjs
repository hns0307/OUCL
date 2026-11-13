import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url)), base=path.resolve(here,'../..');
const read=async file=>JSON.parse(await readFile(path.join(here,file),'utf8'));
const snapshot=await read('runtime/snapshot.json');
const rows=(await readFile(path.join(here,'runtime/events.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
assert.equal(snapshot.state,'EXECUTED_CHECKS_COMPLETE');assert.deepEqual(snapshot.issues,[]);
const primary=snapshot.reports.find(r=>r.role==='primary'), outsider=snapshot.reports.find(r=>r.role==='untrusted');
assert.equal(primary.results.length,6);assert.equal(outsider.results.length,3);
for(const r of primary.results){assert.equal(r.reply.ok,false);assert.equal(r.reply.error.code,'INVALID_ARGUMENT');}
for(const r of outsider.results){assert.equal(r.reply.ok,false);assert.equal(r.reply.error.code,'INVALID_SENDER');}
assert.equal(primary.identity.isMainFrame,true);assert.equal(primary.identity.primaryWindow,true);
assert.equal(outsider.identity.isMainFrame,true);assert.equal(outsider.identity.primaryWindow,false);
const originalError=rows.find(r=>r.kind==='original-handler-return'&&r.code==='PREVIEW_EXPIRED');
const corrupt=rows.find(r=>r.kind==='production-preload-corruption-result');
assert.ok(originalError);assert.equal(corrupt.rejectedAsUnavailable,true);assert.equal(corrupt.reply.error.code,'UNAVAILABLE');
assert.equal(snapshot.archiveWorkers,0);assert.equal(snapshot.validStartsReturned,0);
for(const row of rows.filter(r=>r.kind==='actual-window-preferences')){
  assert.equal(row.preferences.sandbox,true);assert.equal(row.preferences.contextIsolation,true);assert.equal(row.preferences.nodeIntegration,false);
  assert.notEqual(row.preferences.nodeIntegrationInSubFrames,true);
}
assert.equal(rows.filter(r=>r.kind==='uncaught-exception'||r.kind==='test-sequence-error').length,0);
for(const item of snapshot.productManifest){assert.equal(createHash('sha256').update(await readFile(path.join(base,'dist',item.path))).digest('hex'),item.sha256);}
const exit=await read('runtime/process-exit.json');assert.equal(exit.exitCode,0);
let owner=false;try{await access(path.join(here,'runtime/profile/metadata/owner.lock'));owner=true;}catch(error){if(error.code!=='ENOENT')throw error;}assert.equal(owner,false);
const db=new DatabaseSync(path.join(here,'runtime/profile/metadata/tasks.sqlite'),{readOnly:true});
const counts={};try{for(const table of ['tasks','requests','operations'])counts[table]=db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;}finally{db.close();}
assert.equal(counts.tasks,0);assert.equal(counts.requests,0);
const result={status:'PASS_REACHABLE_SUBSET',illegalInputRejections:6,untrustedDocumentRejections:3,corruptedRequestIdRejectedByProductionPreload:true,
  productHashes:7,archiveWorkers:0,validStartsReturned:0,finalTableCounts:counts,normalExit:exit,ownerPresent:false,
  pending:['non-primary frame under unchanged preferences','wrong previewId and URL/path response variants','direct inventory.scan count','all C-R7 checks outside this subset']};
await writeFile(path.join(here,'verification.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
