const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=__dirname,parent=path.dirname(base);const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const rows=fs.readFileSync(path.join(base,'window.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const first=read(path.join(base,'first-admission.json'));
const held=rows.filter(r=>r.kind==='held');assert.equal(held.length,2);
for(const h of held){assert.equal(h.result.data.previewId,first.previewId);assert.equal(h.result.data.status,'completed');const d=rows.find(r=>r.kind==='delivered'&&r.invocation===h.invocation);assert.ok(d);assert.deepEqual(d.result,h.result);assert.ok(d.elapsedMs>=(h.channel.endsWith('Cancel')?2450:7950));}
const cancel=held.find(r=>r.channel==='mods:maintenancePreviewCancel');assert.ok(cancel);
const delivery=rows.find(r=>r.kind==='delivered'&&r.invocation===cancel.invocation);
const b=rows.filter(r=>r.kind==='dom'&&r.value.selected&&r.value.selected!==first.input.instanceId);
const early=b.find(r=>r.monoMs>cancel.monoMs&&r.monoMs<delivery.monoMs);assert.ok(early,'B must precede cancel delivery');
for(const r of b){assert.equal(r.value.files.length,3);for(const f of r.value.files){assert.ok(f.filename.startsWith('beta-'));assert.ok(!f.previewText.includes('alpha'));assert.ok(!f.buttons.some(x=>x.text.includes('取消')));assert.ok(!f.previewText.includes('存在阻止因素'));}}
assert.equal(rows.filter(r=>r.kind==='handled'&&r.channel==='mods:maintenancePreview').length,1);
const exit=rows.find(r=>r.kind==='exit');assert.equal(exit.code,0);
const before=read(path.join(parent,'v4-bc/state-v23-cancel-late-before.json')),after=read(path.join(parent,'v4-bc/state-v23-cancel-late-after.json'));
assert.equal(before.hashes.length,6);assert.equal(before.tasks.length,5);assert.deepEqual(after,before);
const products=read(path.join(parent,'product-manifest.json'));assert.equal(products.length,7);
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
for(const item of products)assert.equal(sha(fs.readFileSync(path.join(parent,'product',item.path))),item.sha256);
const seed=read(path.join(parent,'v4-bc/seed.json'));const owner=path.join(seed.profile,'metadata/owner.lock');assert.equal(fs.existsSync(owner),false,'owner marker released');
const earlier=read(path.join(parent,'c-r5-admission-v20/audit.json'));
const audit={status:'LIMITED_RECEIPT_TIMING_PASS',previewId:first.previewId,cancelHeld:cancel.time,earlyB:early.time,delivered:delivery.time,
 postReleaseBDom:b.filter(r=>r.monoMs>delivery.monoMs).length,exit,productsChecked:products.length,sixJarsFiveTasksUnchanged:true,
 beforeScope:'snapshot taken after initial preview started; only cancellation stage protected',ownerMarkerAbsentAtAudit:true,
 screenshot:{file:'b-after-late.png',sha256:sha(fs.readFileSync(path.join(base,'b-after-late.png'))),visualReview:'coordinator supplied; not reinterpreted here'},
 priorR5:earlier.results,toolGap:'verify.cjs did not exist; prior MODULE_NOT_FOUND was an audit-tool gap, not product failure; empty verification.log retained',
 limits:['Deduplicated DOM may have no new B snapshot after release; coordinator screenshot consumption separate','Three finite R5 receipt cases only; not all cancellation or cross-instance timings']};
fs.writeFileSync(path.join(base,'audit.json'),JSON.stringify(audit,null,2));
fs.writeFileSync(path.join(base,'AUDIT.md'),'# C-R5 cancel迟到有限审计\n\n原始completed status保持8秒；原cancel真实completed保持2500ms，原样交付。B实际DOM在cancel hold与release之间，唯一接纳，同preview身份，exit0，七产物摘要一致、六JAR五任务快照完全一致、审计时owner.lock已释放。精确时间和身份见audit.json。\n\nbefore快照在首预览开始后，只保证取消阶段数据不变，不覆盖初始预览之前。B记录仅三beta文件、无alpha结果或取消控制；释放后DOM去重可能没有新行，不能以空集宣称独立持续观察通过。主协调已看b-after-late.png，此处固定文件哈希并与日志层级区分。\n\nadmission及status-r2既有审计形成切换早于原回执释放的有限时序证据；status首轮切换过晚继续PENDING，未覆盖失败。加上本次cancel，三个R5有限格按各自时序/原回执/协调者截图消费分层闭合，不等于完整历史矩阵全部通过。\n\n旧verify.cjs缺失导致MODULE_NOT_FOUND属于审计工具缺项，不是产品失败；空verification.log及原证据保持原样。复现：在本独立验收树运行 node acceptance-results/c-r5-cancel-v21/audit.cjs。该脚本不启动GUI/业务、不修改产品或旧日志，仅重写新增audit.json/AUDIT.md。\n');
console.log('PASS: original receipts, B-before-release, single admission, exit0, 7 products, 6 JAR/5 tasks and absent owner marker.');
