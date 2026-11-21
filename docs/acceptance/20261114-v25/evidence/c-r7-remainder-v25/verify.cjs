const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const base=__dirname,root=path.resolve(base,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'acceptance-results/product-manifest.json')));assert.equal(manifest.length,7);
for(const p of manifest)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist',p.path))).digest('hex'),p.sha256);
const file=path.join(base,'runtime/events.jsonl');
if(!fs.existsSync(file)){console.log('PREPARED_NOT_RUN; seven product hashes match');process.exit(0);}
const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
const conflict=rows.find(r=>r.kind==='same-request-different-input-result');assert.ok(conflict);assert.equal(conflict.result.first.ok,true);assert.equal(conflict.result.conflict.ok,false);assert.equal(conflict.result.conflict.error.code,'INVALID_ARGUMENT');
for(const mode of ['bad-previewId','url-field','path-field']){const r=rows.find(r=>r.kind==='remainder-preload-result'&&r.mode===mode);assert.ok(r);assert.equal(r.faultApplied,true);assert.equal(r.reply.ok,false);assert.equal(r.reply.error.code,'UNAVAILABLE');}
assert.equal(rows.filter(r=>r.kind==='test-only-response-corruption').length,3);
assert.ok(!rows.some(r=>r.kind==='actual-mod-archive-worker'));
console.log('Finite remainder checks PASS; injected queued envelopes are synthetic negative fixtures, not domain successes. Exit/owner audit remains separate.');
