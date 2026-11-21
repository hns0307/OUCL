const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=__dirname;const manifest=JSON.parse(fs.readFileSync(path.join(base,'../product-manifest.json')));
assert.equal(manifest.length,7);for(const item of manifest)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'../product',item.path))).digest('hex'),item.sha256);
const log=path.join(base,'window.jsonl');if(!fs.existsSync(log)){console.log('PREPARED_NOT_RUN; seven product pins match');process.exit(0);}
const rows=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
const first=JSON.parse(fs.readFileSync(path.join(base,'first-admission.json')));
const holds=rows.filter(r=>r.kind==='held');
assert.equal(holds.length,2);
for(const channel of ['mods:maintenancePreviewStatus','mods:maintenancePreviewCancel']){
 const h=holds.find(r=>r.channel===channel);assert.ok(h);assert.equal(h.input.payload.previewId,first.previewId);assert.equal(h.result.data.status,'completed');
 const delivery=rows.find(r=>r.kind==='delivered'&&r.invocation===h.invocation);assert.ok(delivery);assert.deepEqual(delivery.result,h.result);assert.ok(delivery.elapsedMs>=7900);
}
assert.ok(!rows.some(r=>r.kind==='additional-admission'));
const lastHold=Math.max(...holds.map(r=>r.monoMs));
assert.ok(rows.some(r=>r.kind==='handled'&&r.channel==='mods:maintenancePreviewStatus'&&r.monoMs>lastHold+8000&&r.input.payload.previewId===first.previewId&&r.result?.data?.status==='completed'));
assert.ok(rows.some(r=>r.kind==='exit'&&r.code===0));
console.log('Receipt identity/delivery checks PASS; DOM TIMEOUT, manual cancel/query and result visibility require separate screenshot/log review.');
