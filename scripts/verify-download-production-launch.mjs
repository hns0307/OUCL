import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setInterval, clearInterval } from 'node:timers';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { ProfileService } from '../.test-build/src/services/launch/profiles.js';
import { InstallerService } from '../.test-build/src/services/install/installer.js';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { InstallMetadataService } from '../.test-build/src/services/catalog/install-metadata.js';
import { LaunchService } from '../.test-build/src/services/launch/service.js';
import { GameProcessService } from '../.test-build/src/services/launch/process.js';
const evidence='docs/validation/DOWNLOADS-main/game';
const installed=JSON.parse(await readFile(path.join(evidence,'official-install.json'),'utf8'));assert.equal(installed.dataKey,'download-regression');assert.equal(installed.status,'PASS');
const entry=new URL('../.test-build/src/services/workers/entry.js',import.meta.url);
const storage=await StorageClient.open(entry,path.resolve('.test-build/download-regression/metadata'));
const reader=new OfficialMetadataReader();const installer=new InstallerService(storage,entry,new InstallMetadataService(new CatalogService(reader,storage),reader));
const profiles=new ProfileService(storage);const processes=new GameProcessService();const launches=new LaunchService(storage,profiles,installer,processes);
let report;let session;let timer;
try{
  await installer.initialize();await launches.initialize();await profiles.registerJava(process.argv[2]);
  const existing=(await profiles.list()).accounts.find(item=>item.gameName==='OUCL_Download');
  const account=existing??await profiles.createOffline(randomUUID(),{displayName:'Download regression',gameName:'OUCL_Download'});
  const instance=await storage.readInstance(installed.instanceId);assert.ok(instance);
  const task=await launches.launch(randomUUID(),{instanceId:installed.instanceId,accountId:account.accountId,expectedRevision:instance.revision});
  for(;;){const current=await launches.task(installed.rootId,task.taskId);assert.ok(current);if(['completed','failed','cancelled','needsRecovery'].includes(current.task.execution.state)){assert.equal(current.task.execution.state,'completed');break;}await new Promise(r=>setTimeout(r,200));}
  session=await launches.session(installed.rootId,task.taskId);
  report={status:'RUNNING',productionLaunchService:true,sessionId:session.sessionId,instanceId:installed.instanceId};
  await writeFile(path.join(evidence,`production-launch-${process.argv[3]??'first'}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  timer=setInterval(()=>console.log(JSON.stringify({state:processes.get(session.sessionId).state,milestones:processes.diagnostics(session.sessionId)})),10000);
  const exited=await processes.wait(session.sessionId);assert.equal(exited.state,'exited');assert.equal(exited.exitCode,0);
  report={...report,status:'PASS',exitCode:exited.exitCode,milestones:processes.diagnostics(session.sessionId)};
}catch(error){report={...report,status:'FAIL',code:error.code??error.message};process.exitCode=1;}
finally{clearInterval(timer);if(await launches.close()){await profiles.close();await installer.close();await storage.close();}else{report={...report,status:'RUNNING',code:'TEST_GAME_STILL_RUNNING'};process.exitCode=1;}await writeFile(path.join(evidence,`production-launch-${process.argv[3]??'first'}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}

