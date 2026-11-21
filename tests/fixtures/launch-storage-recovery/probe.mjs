import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { pathToFileURL } from 'node:url';
if (!process.env.OUCL_D01_BUNDLE) throw Error('Set OUCL_D01_BUNDLE');
const { LaunchService } = await import(pathToFileURL(process.env.OUCL_D01_BUNDLE).href);
const root='00000000-0000-4000-8000-000000000001', taskId='00000000-0000-4000-8000-000000000002', instanceId='00000000-0000-4000-8000-000000000003', accountId='00000000-0000-4000-8000-000000000004', requestId='00000000-0000-4000-8000-000000000005';
const copy=x=>globalThis.structuredClone(x); const timeout=()=>Object.assign(new Error('injected unavailable'),{code:'TIMEOUT'});
let durable, registry={revision:0,data:{items:[]}}, unhealthy=false, spawn=0, lost=0, failedGet=0, failedSave=0;
const storage={
 readInstallation:async()=>({revision:1,data:{rootId:root}}), readInstance:async()=>({revision:1,data:{summary:{rootId:root},phase:'ready'}}), readSettings:async()=>({revision:1,data:{memoryMiB:2048}}),
 readGameSessions:async()=>copy(registry), writeGameSessions:async(revision,data)=>{if(unhealthy){failedSave++;throw timeout()} assert.equal(revision,registry.revision);registry={revision:revision+1,data:copy(data)};return copy(registry)},
 accept:async(ownerId)=>{if(!durable) durable={ownerId,taskId,kind:'launch',execution:{state:'queued',attempt:0,lastSequence:0,revision:1,bytesDone:0}}; return copy(durable)},
 update:async(ownerId,id,revision,next)=>{assert.equal(revision,durable.execution.revision);durable.execution=copy(next);if(next.state==='committing'&&!lost){lost++;unhealthy=true;throw timeout()} return copy(durable)},
 get:async()=>{if(unhealthy){failedGet++;throw timeout()} return copy(durable)}
};
const account={accountId}, java={javaId:'java',version:'17',major:17,executable:'fixture'};
const profiles={list:async()=>({accounts:[account],javas:[java],selectedJavaId:'java'})};
const sha='a'.repeat(40);
const installer={prepareLaunch:async()=>({prepared:{version:{javaMajor:17,assetIndex:{sha1:sha}},plan:{views:[{area:'assets',artifactId:'sha1-'+sha,path:'indexes/5.json'}],classpath:[]},assets:{}},layout:{},nativeFiles:[]}),verifyPreparedLaunch:async()=>{},inspectLaunchMods:async()=>({fingerprint:'same',local:{state:'satisfied'}})};
const processes={launch:async(_i,_e,_m,_p,opts)=>{await opts.finalize();await opts.commitPermit();spawn++;throw Error('unexpected spawn')},get:()=>{throw Error('no process')}};
const make=()=>new LaunchService(storage,profiles,installer,processes,()=>16*1024**3);
const input={instanceId,accountId,expectedRevision:1}; const service=make(); await service.initialize(); assert.deepEqual(await service.launch(requestId,input),{taskId}); const jobResult=service.jobs.get(taskId).done.catch(error=>error);
for(let i=0;i<100 && !failedSave;i++) await new Promise(r=>setTimeout(r,5));
assert.equal(lost,1);assert.ok(failedGet>=2);assert.equal(failedSave,1);assert.equal(spawn,0); const jobError=await jobResult; assert.ok(jobError instanceof AggregateError); assert.equal(jobError.cause, jobError.errors[0]); assert.deepEqual(jobError.errors.map(e=>e.code),['TIMEOUT','TIMEOUT','TIMEOUT']);
await new Promise(r=>setTimeout(r,10));
for(let i=0;i<3;i++) await assert.rejects(service.task(root,taskId));
assert.equal(durable.execution.state,'committing'); assert.equal(spawn,0);
unhealthy=false;
const query=await service.task(root,taskId);const cancel=await service.cancel(root,taskId).then(()=> 'resolved',e=>e.code);const duplicate=await service.launch(requestId,input); const again=await service.task(root,taskId); const closed=await service.close();
const restarted=make();await restarted.initialize(); const queryAfter=await restarted.task(root,taskId); await restarted.initialize(); const repeated=await restarted.task(root,taskId);const cancelAfter=await restarted.cancel(root,taskId).then(()=> 'resolved',e=>e.code); const duplicateAfter=await restarted.launch(requestId,input); await restarted.close();
assert.equal(query.task.execution.state,'needsRecovery');assert.equal(queryAfter.task.execution.state,'needsRecovery');assert.equal(again.task.execution.revision,query.task.execution.revision);assert.equal(repeated.task.execution.revision,query.task.execution.revision);assert.equal(query.session.spawned,false);assert.equal(query.session.snapshot.state,'unknown');assert.equal(cancel,'INVALID_TASK_STATE');assert.equal(cancelAfter,'INVALID_TASK_STATE');assert.deepEqual(duplicate,{taskId});assert.deepEqual(duplicateAfter,{taskId});assert.equal(closed,true);assert.equal(spawn,0);
console.log(JSON.stringify({lost,failedGet,failedSave,spawn,closed,beforeRestart:{task:query.task.execution,session:query.session,cancel,duplicate},afterRestart:{task:queryAfter.task.execution,session:queryAfter.session,cancel:cancelAfter,duplicate:duplicateAfter}},null,2));

// A registered stale committing task is reconciled during initialization; repeated initialization is idempotent.
durable.execution={state:'committing',attempt:1,lastSequence:2,revision:4,bytesDone:0};const init=make();await init.initialize();assert.equal(durable.execution.state,'needsRecovery');assert.equal(durable.execution.revision,5);await init.initialize();assert.equal(durable.execution.revision,5);await init.close();
// A CAS conflict never overwrites the authoritative state; a later read may retry.
durable.execution={state:'committing',attempt:1,lastSequence:2,revision:4,bytesDone:0};const originalUpdate=storage.update;let conflict=true;storage.update=async(...args)=>{if(conflict){conflict=false;throw Object.assign(Error('conflict'),{code:'REVISION_CONFLICT'})}return originalUpdate(...args)};
const cas=make();await cas.initialize();assert.equal(durable.execution.state,'committing');assert.equal((await cas.task(root,taskId)).task.execution.state,'needsRecovery');await cas.close();storage.update=originalUpdate;
// A live job at committing remains active, including during query and repeated initialize.
durable=undefined;registry={revision:0,data:{items:[]}};unhealthy=false;lost=1;spawn=0;let resume;let entered;const waiting=new Promise(r=>{resume=r});const reached=new Promise(r=>{entered=r});
processes.launch=async(_i,_e,_m,_p,opts)=>{await opts.finalize();await opts.commitPermit();entered();await waiting;throw Object.assign(Error('fixture'),{code:'NEEDS_RECOVERY'})};
const active=make();await active.initialize();await active.launch(requestId,input);await reached;assert.equal((await active.task(root,taskId)).task.execution.state,'committing');await active.initialize();assert.equal(durable.execution.state,'committing');resume();await active.close();assert.equal(durable.execution.state,'needsRecovery');assert.equal(spawn,0);
console.log(JSON.stringify({initialization:'pass',casConflictRetry:'pass',activeJobGuard:'pass'}));

// Owned process guard is independent of the persisted spawned flag.
durable=undefined;registry={revision:0,data:{items:[]}};lost=1;let finish;let processState='running';const exited=new Promise(r=>{finish=r});
const session={sessionId:taskId,instanceId,state:'running',revision:2,startedAt:'2026-11-14T00:00:00.000Z'};
processes.launch=async(_i,_e,_m,_p,opts)=>{await opts.finalize();await opts.commitPermit();return session};processes.wait=()=>exited;processes.get=()=>({...session,state:processState});
const owned=make();await owned.initialize();await owned.launch(requestId,input);for(let i=0;i<100&&durable.execution.state!=='completed';i++)await new Promise(r=>setTimeout(r,5));assert.equal(durable.execution.state,'completed');
durable.execution={state:'committing',attempt:1,lastSequence:2,revision:4,bytesDone:0};assert.equal((await owned.task(root,taskId)).task.execution.state,'committing');assert.equal(await owned.close(),false);processState='exited';finish({...session,state:'exited',revision:3});await new Promise(r=>setImmediate(r));assert.equal(await owned.close(),true);console.log(JSON.stringify({ownedProcessGuard:'pass'}));

// A failed session save does not prevent successful task reconciliation, and is retained with the action error.
durable=undefined;registry={revision:0,data:{items:[]}};lost=0;unhealthy=false;spawn=0;let failSession=false;
const originalSave=storage.writeGameSessions;storage.writeGameSessions=async(...args)=>{if(failSession)throw Object.assign(Error('save unavailable'),{code:'SAVE_UNAVAILABLE'});return originalSave(...args)};
storage.update=async(owner,id,revision,next)=>{assert.equal(revision,durable.execution.revision);durable.execution=copy(next);if(next.state==='committing'&&!lost){lost++;failSession=true;throw Object.assign(Error('lost acknowledgement'),{code:'ACK_LOST'})}return copy(durable)};
processes.launch=async(_i,_e,_m,_p,opts)=>{await opts.finalize();await opts.commitPermit();spawn++;throw Error('unexpected spawn')};
const partial=make();await partial.initialize();await partial.launch(requestId,input);const partialError=await partial.jobs.get(taskId).done.catch(e=>e);assert.ok(partialError instanceof AggregateError);assert.equal(partialError.cause, partialError.errors[0]);assert.deepEqual(partialError.errors.map(e=>e.code),['ACK_LOST','SAVE_UNAVAILABLE']);assert.equal(durable.execution.state,'needsRecovery');assert.equal(spawn,0);assert.equal(await partial.close(),true);console.log(JSON.stringify({saveFailureRetainedAndRecoveryContinues:true}));
