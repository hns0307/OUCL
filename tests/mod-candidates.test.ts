import test from 'node:test';
import assert from 'node:assert/strict';
import { ModCandidateService } from '../src/services/mods/candidates.js';
import type { ModCandidateInput } from '../src/services/mods/candidates.js';
import type { PlatformModVersion, PlatformDependency } from '../src/core/mods/platform.js';
const id=(value:string):string=>value.padEnd(8,'z');
const dep=(projectId:string|null,versionId:string|null=null):PlatformDependency=>({projectId,versionId,type:'required',filename:null});
function value(projectId:string,versionId=projectId+'1',dependencies:PlatformDependency[]=[]):PlatformModVersion{projectId=id(projectId);versionId=id(versionId);dependencies=dependencies.map(item=>({...item,projectId:item.projectId?id(item.projectId):null,versionId:item.versionId?id(item.versionId):null}));return {projectId,versionId,dependencies,name:projectId,versionNumber:'1',release:'release',publishedAt:'2026-01-01T00:00:00Z',loaders:['fabric'],gameVersions:['1.20.1'],environment:'client_and_server',files:[{filename:projectId+'.jar',url:`https://cdn.modrinth.com/data/${projectId}/a.jar`,size:1,sha1:'a'.repeat(40),sha512:'b'.repeat(128),primary:true}],evidence:{url:'https://api.modrinth.com/v2/version/'+versionId,sha256:'c'.repeat(64)}};}
const input=():ModCandidateInput=>({roots:[id('A1')],selections:{},installed:[],minecraft:'1.20.1',loader:'fabric',unknownInstalled:false});
function client(versions:PlatformModVersion[]){const calls:string[]=[];return {calls,version:async(id:string)=>{calls.push(id);const version=versions.find(v=>v.versionId===id);assert.ok(version);return version;},candidates:async(project:string)=>{calls.push('project:'+project);return versions.filter(v=>v.projectId===project);}};}
test('pinned closure recursively fetches exact versions and deduplicates shared projects',async()=>{
 const api=client([value('A','A1',[dep('B','B1'),dep('C','C1')]),value('B','B1',[dep('D','D1')]),value('C','C1',[dep('D','D1')]),value('D')]);
 const result=await new ModCandidateService(api).collect(input());assert.equal(result.graph.state,'resolved');assert.equal(result.selected.length,4);assert.equal(api.calls.filter(id=>id===('D1').padEnd(8,'z')).length,1);assert.deepEqual(result.options,[]);
});
test('project-only dependencies return explicit choices and never silently select a preferred release',async()=>{
 const api=client([value('A','A1',[dep('B')]),value('B')]);const service=new ModCandidateService(api);const first=await service.collect(input());assert.equal(first.graph.state,'unknown');assert.equal(first.options[0]?.versions[0]?.versionId,id('B1'));assert.equal(first.selected.length,1);
 const data=input();data.selections={[id('B')]:id('B1')};const second=await service.collect(data);assert.equal(second.graph.state,'resolved');assert.equal(second.selected.length,2);
});
test('installed versions are reused without querying an upgrade and pins never replace them',async()=>{
 const api=client([value('A','A1',[dep('B')]),value('B','B2')]);const data=input();data.installed=[value('B')];data.selections={[id('B')]:id('B2')};
 const result=await new ModCandidateService(api).collect(data);assert.equal(result.graph.state,'resolved');assert.equal(result.graph.nodes.find(n=>n.projectId===id('B'))?.disposition,'reuse');assert.deepEqual(api.calls,[id('A1')]);
 const pinned=client([value('A','A1',[dep('B','B2')]),value('B','B2')]);assert.equal((await new ModCandidateService(pinned).collect(data)).graph.state,'conflict');
});
test('a fixed-version identity substitution is rejected before becoming a candidate',async()=>{
 const api=client([value('A','A1',[dep('B','C1')]),value('C')]);await assert.rejects(new ModCandidateService(api).collect(input()),{code:'UNTRUSTED_METADATA'});
});
test('cancellation joins metadata reads, prevents expansion, and one active collection is bounded',async()=>{
 let release!:(version:PlatformModVersion)=>void;const gate=new Promise<PlatformModVersion>(resolve=>{release=resolve;});const abort=new AbortController();
 const service=new ModCandidateService({version:async()=>gate,candidates:async()=>[]});const pending=service.collect(input(),abort.signal);
 await assert.rejects(service.collect(input()),{code:'PLATFORM_LIMIT'});abort.abort();release(value('A','A1',[dep('B','B1')]));await assert.rejects(pending,{code:'CANCELLED'});
 await assert.rejects(service.collect({...input(),roots:[]}),{code:'INVALID_ARGUMENT'});
});
test('cycles and depth are bounded while input snapshots and fetched metadata stay unchanged',async()=>{
 const versions=[value('A','A1',[dep('B','B1')]),value('B','B1',[dep('A','A1')])];const before=JSON.stringify(versions);const result=await new ModCandidateService(client(versions)).collect(input());assert.equal(result.graph.state,'conflict');assert.equal(JSON.stringify(versions),before);
 const deep=Array.from({length:35},(_,i)=>value('P'+i,'V'+i,i<34?[dep('P'+(i+1),'V'+(i+1))]:[]));const api=client(deep);const data=input();data.roots=[id('V0')];assert.equal((await new ModCandidateService(api).collect(data)).graph.state,'unknown');assert.ok(api.calls.length<=33);
});
test('fixed version conflicts remain visible, option truncation is explicit, and false project candidates are refused',async()=>{
 const fixed=client([value('A','A1',[dep('B','B1'),dep('B','B2')]),value('B'),value('B','B2')]);assert.equal((await new ModCandidateService(fixed).collect(input())).graph.state,'conflict');
 const api=client([value('A','A1',[dep('B')]),...Array.from({length:33},(_,i)=>value('B','B'+i))]);const result=await new ModCandidateService(api).collect(input());assert.equal(result.options[0]?.truncated,true);assert.equal(result.options[0]?.versions.length,32);
 await assert.rejects(new ModCandidateService({...api,candidates:async()=>[value('C')]}).collect(input()),{code:'UNTRUSTED_METADATA'});
});



test('a later exact pin removes a previously offered project choice',async()=>{
 const api=client([value('A','A1',[dep('C','C1'),dep('B')]),value('C','C1',[dep('B','B1')]),value('B')]);
 const result=await new ModCandidateService(api).collect(input());assert.equal(result.graph.state,'resolved');assert.deepEqual(result.options,[]);
});
