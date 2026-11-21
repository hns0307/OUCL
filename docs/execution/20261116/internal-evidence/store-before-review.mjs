import { DistributionStore } from './store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const base = path.dirname(new URL(import.meta.url).pathname.slice(1));
await mkdir(base, { recursive: true });
const scope = {sourceId:'review-source',packageId:'review-package'};
const first = {sequence:1,releaseSha256:'a'.repeat(64)};
const results = [];
{
 const root = await mkdtemp(path.join(base,'fault-')); const store = await DistributionStore.open(root);
 const other = new DatabaseSync(path.join(root,'distribution.sqlite')); other.exec('DROP TABLE release_states'); other.close();
 try { await store.read(scope); results.push({kind:'sql-read',unexpected:'success'}); }
 catch(error){results.push({kind:'sql-read',name:error.name,code:error.code,message:error.message});}
 await store.close();
}
for(let attempt=0;attempt<15;attempt++){
 const root=await mkdtemp(path.join(base,'race-'));const store=await DistributionStore.open(root);
 await store.compareAndSet(scope,undefined,first);
 const values=await Promise.allSettled([store.close(),...Array.from({length:4},()=>store.read(scope))]);
 for(const value of values)if(value.status==='rejected')results.push({kind:'close-race',attempt,name:value.reason.name,code:value.reason.code,message:value.reason.message});
 await store.close();
}
await writeFile(path.join(base,'result.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({sql:results.filter(v=>v.kind==='sql-read'),rawCloseErrors:results.filter(v=>v.kind==='close-race'&&v.name!=='StorageError'),controlledCloseErrors:results.filter(v=>v.kind==='close-race'&&v.name==='StorageError').length},null,2));
