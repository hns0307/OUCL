import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const report='D:/MC_start/OUCL-review-round-20261114/P-A/verification/v33-game-preparation';
const candidate='D:/MC_start/OUCL-remediation-20261114-r1';
const source='D:/MC_start/OUCL-PA-clone-20261112';
const target='D:/MC_start/OUCL-acceptance-v33-20261114/game-data';
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const file of [target,source+'/OUCL.runtime/profile/metadata/owner.lock',source+'/OUCL.games/store/objects.owner.lock']) {
 try {await access(file);throw new Error('MUST_NOT_EXIST:'+file);}catch(e){if(e.code!=='ENOENT')throw e;}
}
const db=new DatabaseSync(source+'/OUCL.runtime/profile/metadata/tasks.sqlite',{readOnly:true});
try {
 assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE json_extract(execution,'$.state') NOT IN ('completed','failed','cancelled','needsRecovery')").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM operations WHERE phase != 'COMMITTED'").get().n,0);
}finally{db.close();}
const audit=JSON.parse(await readFile('D:/MC_start/OUCL-download-main/docs/acceptance/20261114-v32/evidence/package-audit-v32.json'));
const outputs=[];
for(const item of audit.embeddedEntries.filter(e=>e.path.startsWith('dist/'))){assert.equal(hash(await readFile(candidate+'/'+item.path)),item.sha256);outputs.push(item);}
assert.equal(outputs.length,7);
await writeFile(report+'/production-seven-sha256.json',JSON.stringify({sourceCommit:audit.sourceCommit,outputs},null,2),{flag:'wx'});
let script=await readFile('D:/MC_start/OUCL-acceptance-v11-20261113/acceptance-results/game-data/prepare.mjs','utf8');
script=script.replaceAll("'./compiled/src/", "'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/");
script=script.replace("const target = path.join(here, 'isolated');",`const target = '${target}';`);
script=script.replace(/const entry = new URL\([^\n]+/,'const entry = new URL("file:///D:/MC_start/OUCL-remediation-20261114-r1/dist/workers/entry.cjs");');
script=script.replace("displayName: 'A v11 coexistence', gameName: 'OUCLAV11'","displayName: 'A v33 coexistence', gameName: 'OUCLAV33'");
// Check object ownership and active task state again immediately before any destination creation.
script=script.replace('await mkdir(metadata, { recursive: true });',`await noFile(path.join(source, 'OUCL.games/store/objects.owner.lock'));
const preflightDb = new DatabaseSync(path.join(sourceMetadata,'tasks.sqlite'),{readOnly:true});
try { assert.equal(preflightDb.prepare("SELECT COUNT(*) n FROM tasks WHERE json_extract(execution,'$.state') NOT IN ('completed','failed','cancelled','needsRecovery')").get().n,0); } finally { preflightDb.close(); }
await mkdir(metadata, { recursive: true });`);
await writeFile(report+'/prepare.mjs',script,{flag:'wx'});
console.log('PREFLIGHT_PASS; seven production outputs match v32; preparation script persisted');
