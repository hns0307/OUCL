import { setImmediate } from 'node:timers';
import assert from 'node:assert/strict';

import path from 'node:path';
import { pathToFileURL } from 'node:url';
const built = process.env.OUCL_D02_BUILT_ROOT;
if (!built) throw new Error('OUCL_D02_BUILT_ROOT is required');
const { GameAdapter } = await import(pathToFileURL(path.join(built, 'adapter.mjs')).href);
const { LaunchControls } = await import(pathToFileURL(path.join(built, 'control.mjs')).href);
import { reset, begin, flush } from './react-shim.mjs';
const root='00000000-0000-4000-8000-000000000001'; const taskId='00000000-0000-4000-8000-000000000002';
const instanceId='00000000-0000-4000-8000-000000000003'; const accountId='00000000-0000-4000-8000-000000000004';

function task(state,reason){return {task:{taskId,ownerId:root,kind:'launch',execution:{state,attempt:1,lastSequence:3,revision:4,bytesDone:0}},session:{rootId:root,taskId,spawned:false,stopTaskIds:[],snapshot:{sessionId:taskId,instanceId,state:'unknown',revision:1,startedAt:'2026-11-14T00:00:00.000Z'},...(reason?{errors:[{taskId,code:reason}]}:{})}};}
async function snapshot(state,reason){const value=task(state,reason);const service={hasTask:()=>true,task:async()=>value,tasks:async()=>[value]};const adapter=new GameAdapter(service,async()=>root);return (await adapter.get(root,taskId)).snapshot;}
function textOf(node){if(node===null||node===undefined||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return textOf(node.props?.children);}
function find(node,predicate){if(node===null||node===undefined||typeof node!=='object')return; if(Array.isArray(node)){for(const item of node){const found=find(item,predicate);if(found)return found;}return;}if(predicate(node))return node;return find(node.props?.children,predicate);}
async function renderStatus(snap,getMode='ok'){reset(); let launchCalls=0; globalThis.window={oucl:{launchGame:async()=>{launchCalls++;return {ok:true,data:{taskId}}},subscribeTask:async()=>({result:{ok:true,data:{snapshot:snap}},dispose(){}}),getTask:async()=>{if(getMode==='reject')throw new Error('fixture transport rejection');return {ok:true,data:{snapshot:snap}}}}};
 const props={instance:{instanceId,rootId:root,taskId,displayName:'fixture',mcVersionId:'1.20.1',isolation:'on',state:'ready',revision:1},accountId,current:undefined};
 const render=()=>{begin();const tree=LaunchControls(props);flush();return tree;};let tree=render();const button=find(tree,n=>n.type==='button'&&textOf(n)==='启动游戏');assert.ok(button);button.props.onClick();
 await new Promise(r=>setImmediate(r));render();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));tree=render();const alert=find(tree,n=>n.props?.role==='alert');const buttonAfter=find(tree,n=>n.type==='button'&&n.props?.className==='primary'); if(snap.state==='needsRecovery'){buttonAfter.props.onClick();await new Promise(r=>setImmediate(r));} return {text:alert?textOf(alert):null,buttonDisabled:buttonAfter?.props.disabled??null,launchCalls};}
const rows=[];
for(const reason of ['REVISION_CONFLICT','LAUNCH_FAILED','NEEDS_RECOVERY']){const snap=await snapshot('needsRecovery',reason);const ui=await renderStatus(snap);rows.push({state:'needsRecovery',reason,code:snap.error?.code,retryable:snap.error?.retryable,messageKey:snap.error?.messageKey,ui});}
for(const [state,reason] of [['queued',null],['running',null],['failed','REVISION_CONFLICT'],['failed','LAUNCH_FAILED']]){const snap=await snapshot(state,reason);rows.push({state,reason,code:snap.error?.code??null,retryable:snap.error?.retryable??null,messageKey:snap.error?.messageKey??null,ui:await renderStatus(snap)});}
const rejectedSnapshot=await snapshot('needsRecovery','REVISION_CONFLICT');const rejectedUi=await renderStatus(rejectedSnapshot,'reject');rows.push({state:'needsRecovery-rejected-read',reason:'REVISION_CONFLICT',ui:rejectedUi});
const expectedRecovery='需要恢复，请保留文件并检查目录状态。';assert.equal(rejectedUi.text,expectedRecovery);assert.equal(rejectedUi.buttonDisabled,true);assert.equal(rejectedUi.launchCalls,1);
const failures=[];
for(const r of rows.filter(x=>x.state==='needsRecovery')) {if(r.code!=='NEEDS_RECOVERY'||r.retryable!==false||r.ui.text!==expectedRecovery||r.ui.buttonDisabled!==true||r.ui.launchCalls!==1)failures.push(r.reason);}
assert.equal(rows.find(x=>x.state==='queued').code,null);assert.equal(rows.find(x=>x.state==='running').code,null); for (const r of rows.filter(x=>['queued','running'].includes(x.state))) { assert.equal(r.ui.text,null);assert.equal(r.ui.buttonDisabled,true); }
assert.equal(rows.find(x=>x.state==='failed'&&x.reason==='REVISION_CONFLICT').code,'REVISION_CONFLICT');assert.equal(rows.find(x=>x.state==='failed'&&x.reason==='LAUNCH_FAILED').code,'LAUNCH_FAILED'); for (const r of rows.filter(x=>x.state==='failed')) {assert.equal(r.ui.buttonDisabled,false);assert.notEqual(r.ui.text,expectedRecovery);}
console.log(JSON.stringify({fixture:'real GameAdapter plus real LaunchControls with hook/bridge doubles; no Electron or storage',rows,failedRecoveryCases:failures},null,2));
if(failures.length) process.exitCode=1;
