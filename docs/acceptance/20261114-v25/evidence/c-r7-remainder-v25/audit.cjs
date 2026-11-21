const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const base=__dirname,root=path.resolve(base,'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const rows=fs.readFileSync(path.join(base,'runtime/events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const conflict=rows.find(r=>r.kind==='same-request-different-input-result');assert.ok(conflict);
assert.equal(conflict.result.first.ok,true);assert.equal(conflict.result.conflict.ok,false);assert.equal(conflict.result.conflict.error.code,'INVALID_ARGUMENT');
assert.equal(conflict.result.first.requestId,conflict.requestId);assert.equal(conflict.result.conflict.requestId,conflict.requestId);
const starts=rows.filter(r=>r.kind==='original-handler-return'&&r.channel==='mods:maintenancePreview');assert.equal(starts.length,2);assert.deepEqual(starts.map(r=>r.requestId),[conflict.requestId,conflict.requestId]);
// Inputs themselves are sent by the pinned harness expression: original input then {...input, action:'enable'}.
const script=fs.readFileSync(path.join(base,'harness.cjs'),'utf8');assert.ok(script.includes('action:"enable"'));assert.equal(conflict.input.action,'disable');
const modes=['bad-previewId','url-field','path-field'];const checks=[];
for(const mode of modes){
 const injected=rows.filter(r=>r.kind===mode);assert.equal(injected.length,1);const r=injected[0];
 assert.equal(r.original.ok,false);assert.equal(r.original.error.code,'PREVIEW_EXPIRED');assert.equal(r.injected.ok,true);assert.equal(r.original.requestId,r.injected.requestId);
 const original=rows.find(x=>x.kind==='original-handler-return'&&x.requestId===r.original.requestId);assert.ok(original);assert.equal(original.code,'PREVIEW_EXPIRED');assert.ok(original.sequence<r.sequence);
 assert.equal(r.identity.isMainFrame,true);assert.equal(r.identity.primaryWindow,true);
 const reply=rows.find(x=>x.kind==='remainder-preload-result'&&x.mode===mode);assert.ok(reply);assert.equal(reply.faultApplied,true);assert.equal(reply.reply.ok,false);assert.equal(reply.reply.error.code,'UNAVAILABLE');assert.equal(reply.reply.requestId,r.original.requestId);assert.ok(reply.sequence>r.sequence);
 if(mode==='bad-previewId')assert.notEqual(r.injected.data.previewId,'00000000-0000-4000-8000-000000000002');
 else assert.ok(Object.hasOwn(r.injected.data,mode==='url-field'?'url':'path'));
 checks.push({mode,requestId:r.original.requestId,originalSequence:original.sequence,injectionSequence:r.sequence,bridgeSequence:reply.sequence});
}
assert.equal(rows.filter(r=>r.kind==='actual-mod-archive-worker').length,0);assert.ok(rows.some(r=>r.kind==='will-quit'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'acceptance-results/product-manifest.json')));assert.equal(manifest.length,7);for(const p of manifest)assert.equal(sha(fs.readFileSync(path.join(root,'dist',p.path))),p.sha256);
assert.equal(fs.existsSync(path.join(base,'runtime/profile/metadata/owner.lock')),false);
const audit={status:'FINITE_FOUR_CHECKS_PASS',conflict:{requestId:conflict.requestId,previewId:conflict.result.first.data.previewId,result:'INVALID_ARGUMENT',inputEvidence:'recorded first input plus pinned harness expression changes only action; original-handler log lacks complete payload'},checks,products:7,archiveWorkers:0,willQuit:true,ownerMarkerAbsentAtAudit:true,exitCode:null,exitEvidence:'Coordinator reports normal AltF4 close; no process exit0 log, not asserted',originalVerifyFailure:'0 !== 3 is label-count mismatch: log fields.kind overwrote the outer kind with each mode; original script/log preserved',limits:['Synthetic malformed queued response envelopes only, not original domain success','Non-primary frame unreachable under unchanged configuration','Zero worker is not a direct inventory.scan invocation counter']};
fs.writeFileSync(path.join(base,'audit.json'),JSON.stringify(audit,null,2));
fs.writeFileSync(path.join(base,'AUDIT.md'),'# C-R7 剩余四项有限审计\n\n新增audit.cjs已实际执行：同requestId首次接纳、不同action返回INVALID_ARGUMENT；三次真实PREVIEW_EXPIRED分别经负向注入错previewId/额外url/额外path，原preload均返回UNAVAILABLE，request身份及记录顺序一致。七产物摘要一致，零archive worker，will-quit存在，审计时owner.lock不存在。\n\n冲突的原handler日志只记录requestId/返回码，完整输入差异由已运行壳的固定表达式与first input佐证，不伪称原handler已记录全部payload。注入ok=true是明确负向queued夹具，不是领域业务成功。非主frame仍不可达，零worker不等于直接scan计数。\n\n旧verify第10行失败原因是日志fields.kind覆盖外层kind，三条注入记录实际以各mode命名，因此旧计数得到0。属于审计标签误判，不是产品失败。旧脚本、日志及verification.log保持原样，不重跑业务。\n\n主协调正常AltF4关闭；日志有will-quit，但没有进程exit0记录，不声称退出码0。\n\n复现：在v11独立验收树运行 node acceptance-results/c-r7-remainder-v25/audit.cjs。脚本只读产品/原日志，写新增audit.json/AUDIT.md，不启动Electron。\n');
console.log('PASS: four finite checks; 7 products; zero archive workers; will-quit and owner absent. Exit code unverified.');
