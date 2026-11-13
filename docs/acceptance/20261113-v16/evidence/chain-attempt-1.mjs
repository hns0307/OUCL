import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ModInventoryService, ModInspectionService, ModrinthModClient, ModMaintenancePreviewService, presentMaintenancePreview, ModArchiveReader, modZip } from './chain.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
const hash = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const json = value => JSON.stringify(value,null,2);
const fabric = value => JSON.stringify({schemaVersion:1,version:'1.0.0',...value});
async function run(name, { nested = false, dependent = false, pinned = 'ProviderV1', rejected = false } = {}) {
  const location = path.join(directory,name); const modsDirectory = path.join(location,'mods');
  await mkdir(modsDirectory,{recursive:true});
  const entries = [['fabric.mod.json',fabric({id:'parent_mod',provides:['parent_alias'], ...(nested?{jars:[{file:'META-INF/jars/private-child.jar'}]}:{})})],
    ['quilt.mod.json',JSON.stringify({schema_version:1,quilt_loader:{id:'quilt_parent',group:'org.oucl.fixture',version:'1.0.0'}})]];
  if(nested) entries.push(['META-INF/jars/private-child.jar',modZip([['fabric.mod.json',fabric({id:'nested_mod'})]])]);
  const jars = {'provider.jar':modZip(entries)};
  if(dependent) jars['dependent.jar'] = modZip([['fabric.mod.json',fabric({id:'dependent_mod',depends:{parent_alias:'*',...(nested?{nested_mod:'*'}:{})}})]]);
  for(const [filename,bytes] of Object.entries(jars)) await writeFile(path.join(modsDirectory,filename),bytes);
  const manifest = Object.fromEntries(Object.entries(jars).map(([filename,bytes])=>[filename,{size:bytes.length,sha1:hash(bytes,'sha1'),sha256:hash(bytes,'sha256'),sha512:hash(bytes,'sha512')}]));
  const response = {};
  for(const [filename,facts] of Object.entries(manifest)) {
    const provider = filename==='provider.jar'; const project = provider?'ProviderProject':'DependentProject'; const version = provider?'ProviderV1':'DependentV1';
    response[facts.sha512] = {id:version,project_id:project,name:'Synthetic fixture',version_number:'1.0.0',date_published:'2026-11-13T00:00:00Z',version_type:'release',loaders:['fabric'],game_versions:['1.20.1'],environment:'client_and_server',
      dependencies:provider?[]:[{project_id:'ProviderProject',version_id:pinned,file_name:null,dependency_type:'required'}],
      files:[{filename,size:facts.size,hashes:{sha1:facts.sha1,sha512:facts.sha512},primary:true,url:`https://cdn.modrinth.com/data/${project}/versions/${version}/${filename}`}]};
  }
  let requests=0, scans=0, workerReads=0; const scanResults=[];
  const context = async()=>({instanceId,revision:4,modsDirectory,environment:{loader:'fabric',versions:{minecraft:'1.20.1',java:'17'},languageVersions:{}}});
  const reader = new ModArchiveReader(new URL('./worker.cjs',import.meta.url));
  const inventory = new ModInventoryService(context,{read:async(...args)=>{workerReads++;return reader.read(...args);}});
  const first = await inventory.scan(instanceId,4); workerReads=0;
  const client = new ModrinthModClient(async(url,options)=>{
    requests++; assert.equal(url,'https://api.modrinth.com/v2/version_files'); assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit');
    const body = JSON.parse(options.body); assert.equal(body.algorithm,'sha512');
    assert.deepEqual([...body.hashes].sort(),Object.values(manifest).map(f=>f.sha512).sort());
    return rejected?new Response('',{status:429,headers:{'retry-after':'1'}}):new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}});
  });
  const inspection = new ModInspectionService(context,{scan:async(...args)=>{scans++;const result=await inventory.scan(...args);scanResults.push(result);return result;}},client);
  const service = new ModMaintenancePreviewService(async()=>({rootId,inventory:await context()}),inspection);
  const selected=first.items.find(f=>f.filename==='provider.jar');
  const preview=await service.preview({rootId,instanceId,expectedRevision:4,expectedFingerprint:first.fingerprint,fileId:selected.fileId,action:'disable'});
  const display=presentMaintenancePreview(preview);
  assert.equal(scans,2); assert.equal(workerReads,Object.keys(jars).length*2); assert.equal(requests,1);
  assert.equal(scanResults[0].fingerprint,scanResults[1].fingerprint);
  for(const item of first.items) for(const field of ['sha1','sha256','sha512','size']) assert.equal(item[field],manifest[item.filename][field]);
  assert.deepEqual((await readdir(modsDirectory)).sort(),Object.keys(jars).sort());
  for(const [filename,bytes] of Object.entries(jars)) assert.deepEqual(await readFile(path.join(modsDirectory,filename)),bytes);
  const text=JSON.stringify(display);
  for(const forbidden of [modsDirectory,'https:','cdn.modrinth.com','META-INF','private-child.jar','entries','"via"']) assert.ok(!text.includes(forbidden),forbidden);
  await writeFile(path.join(location,'evidence.json'),json({kind:'synthetic HTTP Response; real worker/inventory/inspection/client/preview/presentation',scans,workerReads,requests,manifest,initial:first,preview,display}));
  await writeFile(path.join(location,'synthetic-response.json'),json({status:rejected?429:200,body:rejected?'':response}));
  return {first,preview,display};
}
test('physical parent JAR preview removes its alias and nested providers together, preserving separate platform identity',async()=>{
  const {first,preview,display}=await run('nested-multi',{nested:true,dependent:true});
  const selected=first.items.find(f=>f.filename==='provider.jar');
  assert.deepEqual(selected.archives[0].declarations.map(d=>d.format),['fabric','quilt']);
  assert.equal(selected.archives.length,2);
  assert.deepEqual(display.providers.map(p=>[p.id,p.embeddedDepth]).sort(),[['nested_mod',1],['parent_alias',0],['parent_mod',0]]);
  assert.ok(!preview.impact.after.local.providers.some(p=>p.fileId===selected.fileId));
  assert.equal(display.state,'blocked');
  const dependentId=first.items.find(f=>f.filename==='dependent.jar').fileId;
  assert.deepEqual(display.directRequiredBy,[dependentId]);
  assert.ok(display.relations.some(r=>r.scope==='local'&&r.dependencyModId==='nested_mod'&&r.dependencyProjectId===null));
  assert.ok(display.relations.some(r=>r.scope==='platform'&&r.dependencyModId===null&&r.dependencyProjectId==='ProviderProject'&&r.dependencyVersionId==='ProviderV1'));
  assert.ok(display.issues.some(i=>i.moment==='after'&&i.scope==='local'&&i.dependencyModId==='nested_mod'));
});
test('correct local IDs and matching JAR hashes cannot satisfy a different exact platform version',async()=>{
  const {preview,display}=await run('exact-platform-pin',{dependent:true,pinned:'ProviderV2'});
  assert.equal(preview.impact.before.local.state,'satisfied');
  assert.ok(display.issues.some(i=>i.moment==='before'&&i.code==='PLATFORM_PIN_MISMATCH'&&i.dependencyProjectId==='ProviderProject'&&i.dependencyVersionId==='ProviderV2'&&i.dependencyModId===null));
  assert.ok(!display.relations.some(r=>r.scope==='platform'));
  assert.ok(display.relations.some(r=>r.scope==='local'&&r.dependencyModId==='parent_alias'));
  assert.equal(display.state,'blocked');
});
test('real client HTTP rejection remains unknown when disabling the only physical JAR',async()=>{
  const {preview,display}=await run('platform-rejected',{rejected:true});
  assert.equal(preview.impact.after.local.state,'satisfied');
  assert.deepEqual(preview.platformFailures,['RETRY_LATER']);
  assert.equal(preview.impact.state,'unknown'); assert.equal(display.state,'unknown');
});
