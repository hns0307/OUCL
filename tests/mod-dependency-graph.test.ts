import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDependencyGraph } from '../src/core/mods/dependency-graph.js';
import type { DependencyGraphInput } from '../src/core/mods/dependency-graph.js';
import type { PlatformModVersion, PlatformDependency } from '../src/core/mods/platform.js';
const required = (projectId: string | null, versionId: string | null = null): PlatformDependency => ({projectId,versionId,type:'required',filename:null});
function version(projectId: string, versionId=projectId+'1', dependencies: PlatformDependency[]=[]): PlatformModVersion {
  return {projectId,versionId,dependencies,name:projectId,versionNumber:'1',release:'release',publishedAt:'2026-01-01T00:00:00Z',loaders:['fabric'],gameVersions:['1.20.1'],environment:'client_and_server',
    files:[{filename:projectId+'.jar',size:1,sha1:'a'.repeat(40),sha512:'a'.repeat(128),url:`https://cdn.modrinth.com/data/${projectId}/a.jar`,primary:true}],evidence:{url:'https://api.modrinth.com/v2/version/'+versionId,sha256:'b'.repeat(64)}};
}
const input=(selected:PlatformModVersion[], roots=[selected[0]!.versionId]):DependencyGraphInput=>({selected,roots,installed:[],minecraft:'1.20.1',loader:'fabric',unknownInstalled:false});
test('dependency closure deduplicates diamond projects and preserves every requiring parent',()=>{
 const values=[version('A','A1',[required('B'),required('C')]),version('B','B1',[required('D')]),version('C','C1',[required('D','D1')]),version('D')];
 const result=inspectDependencyGraph(input(values));assert.equal(result.state,'resolved');assert.equal(result.nodes.length,4);assert.deepEqual(result.nodes.find(n=>n.projectId==='D')?.requiredBy,['B','C']);assert.ok(result.nodes.every(n=>n.disposition==='candidate'));
});
test('all incoming fixed-version constraints are checked even after a project was visited',()=>{
 const values=[version('A','A1',[required('B'),required('C')]),version('B','B1',[required('D','D1')]),version('C','C1',[required('D','D2')]),version('D')];
 const result=inspectDependencyGraph(input(values));assert.equal(result.state,'conflict');assert.ok(result.issues.some(i=>i.code==='PIN_CONFLICT'&&i.requiredBy.includes('C')));
});
test('installed projects are reused exactly and never upgraded to satisfy a different selected version',()=>{
 const data=input([version('A','A1',[required('B')]),version('B','B2')]);data.installed=[version('B')];assert.equal(inspectDependencyGraph(data).state,'conflict');
 data.selected=[data.selected[0]!,version('B')];const result=inspectDependencyGraph(data);assert.equal(result.state,'resolved');assert.equal(result.nodes.find(n=>n.projectId==='B')?.disposition,'reuse');
});
test('missing exact candidates, file-only identities, unknown installed files and ambiguous files remain unknown',()=>{
 const data=input([version('A','A1',[required('B','B1'),required(null)])]);data.unknownInstalled=true;const result=inspectDependencyGraph(data);assert.equal(result.state,'unknown');assert.ok(result.issues.some(i=>i.code==='MISSING_CANDIDATE'));assert.ok(result.issues.some(i=>i.code==='UNRESOLVED_IDENTITY'));
 const ambiguous=version('X');ambiguous.files=[{...ambiguous.files[0]!,primary:false},{...ambiguous.files[0]!,filename:'other.jar',primary:false}];assert.ok(inspectDependencyGraph(input([ambiguous])).issues.some(i=>i.code==='FILE_SELECTION'));
 assert.equal(inspectDependencyGraph(input([version('X')],['missing'])).state,'unknown');
});
test('cycles and 32-level/256-project limits stop traversal without pretending resolution',()=>{
 const cycle=[version('A','A1',[required('B')]),version('B','B1',[required('A')])];assert.ok(inspectDependencyGraph(input(cycle)).issues.some(i=>i.code==='CYCLE'));
 const deep=Array.from({length:34},(_,i)=>version('P'+i,'V'+i,i<33?[required('P'+(i+1))]:[]));assert.ok(inspectDependencyGraph(input(deep)).issues.some(i=>i.code==='DEPTH_LIMIT'));
 const wide=Array.from({length:257},(_,i)=>version('P'+i));assert.ok(inspectDependencyGraph(input(wide,wide.map(v=>v.versionId))).issues.some(i=>i.code==='PROJECT_LIMIT'));
});
test('target conflicts, incompatible installed projects, duplicate projects and forged version identities are conflicts',()=>{
 const bad=version('X');bad.loaders=['forge'];assert.equal(inspectDependencyGraph(input([bad])).state,'conflict');
 const server=version('X');server.environment='server_only';assert.equal(inspectDependencyGraph(input([server])).state,'conflict');
 const a=version('A','A1',[{...required('B'),type:'incompatible'}]);const data=input([a]);data.installed=[version('B')];assert.equal(inspectDependencyGraph(data).state,'conflict');
 assert.equal(inspectDependencyGraph(input([version('A'),version('A','A2')])).state,'conflict');
 assert.equal(inspectDependencyGraph(input([version('A','same'),version('B','same')])).state,'conflict');
});
test('optional and embedded declarations do not silently add external projects and input snapshots stay unchanged',()=>{
 const a=version('A','A1',[{...required('B'),type:'optional'},{...required('C'),type:'embedded'}]);const data=input([a]);const before=JSON.stringify(data);assert.equal(inspectDependencyGraph(data).nodes.length,1);assert.equal(JSON.stringify(data),before);
 const byVersion=input([version('A','A1',[required(null,'B1')]),version('B')]);assert.equal(inspectDependencyGraph(byVersion).state,'resolved');
});

test('a previously visited shared tail is rechecked when a deeper path would exceed the limit',()=>{
 const tail=Array.from({length:18},(_,i)=>version('T'+i,'T'+i,i<17?[required('T'+(i+1))]:[]));
 const prefix=Array.from({length:18},(_,i)=>version('P'+i,'P'+i,[required(i<17?'P'+(i+1):'T0')]));
 const root=version('R','R1',[required('T0'),required('P0')]);
 assert.ok(inspectDependencyGraph(input([root,...tail,...prefix])).issues.some(issue=>issue.code==='DEPTH_LIMIT'));
 assert.equal(inspectDependencyGraph(input([],[])).state,'unknown');
});
