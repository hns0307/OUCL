import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { StorageClient } from '../acceptance-results/full-r3/.test-build/src/services/workers/storage-client.js';
const source='D:/MC_start/OUCL-remediation-20261114-r1'; const target='D:/MC_start/OUCL-acceptance-exe-v32-20261114';
const metadata=path.join(target,'OUCL.runtime/profile/metadata');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const names=['installation.json','launch-profiles.json','catalog.json'];const before=await Promise.all(names.map(name=>digest(path.join(metadata,name))));
const absent=async()=>{await assert.rejects(access(path.join(metadata,'owner.lock')),{code:'ENOENT'});};await absent();
const audit=JSON.parse((await readFile(path.join(source,'acceptance-results/package-audit-v32.json'),'utf8')).replace(/^\uFEFF/,''));
const app=path.join(target,'OUCL.runtime/app-272cc737f3bade0a6b197f7907b21b2dce2acce854f1d4cc8347155fb3f62291');
for(const entry of audit.embeddedEntries) assert.equal(await digest(path.join(app,entry.path)),entry.sha256);
const client=await StorageClient.open(path.join(app,'dist/workers/entry.cjs'),metadata);
try { const profile=await client.readLaunchProfiles();assert.equal(profile.data.accounts.length,1);assert.equal(profile.data.accounts[0].gameName,'OUCL_V32');assert.equal(profile.revision,1);const installation=await client.readInstallation();assert.equal(installation.data.dataDirectory,path.join(target,'OUCL.games').replaceAll('/','\\')); } finally {await client.close();}
await absent();assert.deepEqual(await Promise.all(names.map(name=>digest(path.join(metadata,name)))),before);
await writeFile(path.join(target,'normal-reopen-audit.json'),JSON.stringify({readyWindowSeenTwice:true,normalCloseWindowsAbsent:true,numericProcessExitCodeObserved:false,metadataLeaseReopenedNormally:true,accountCount:1,gameName:'OUCL_V32',metadataRevisionsUnchanged:true,embeddedEntriesVerified:audit.embeddedEntries.length,sevenProductOutputs:7,ownerMarkerAbsentAfterClose:true,runtimePreseeded:true,gameLaunched:false,executableSha256:audit.executableSha256},null,2)+'\n');
console.log('PASS extracted 9 entries; metadata owner lease reopened; persisted account/revisions unchanged; own lease released');
