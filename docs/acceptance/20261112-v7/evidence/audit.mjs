import { readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import assert from 'node:assert/strict';
const base=path.resolve('acceptance-results/v6-package');
const portable=path.join(base,'cold-runtime'),runtimeRoot=path.join(portable,'OUCL.runtime');
const label=process.argv[2]; assert.match(label,/^[a-z0-9-]+$/);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pack=JSON.parse(await readFile('docs/validation/BOOTSTRAP-0.3.0-acceptance-20261112-v3/package.json','utf8'));
assert.equal(hash(await readFile(path.join(portable,'OUCL.exe'))),pack.sha256);
const names=await readdir(runtimeRoot);
const runtime=names.filter(n=>n.startsWith('electron-')),apps=names.filter(n=>n.startsWith('app-'));
assert.deepEqual(runtime,[`electron-${pack.runtimeChecksum}`]); assert.deepEqual(apps,[`app-${pack.appHash}`]);
const work=path.join('.test-build','bootstrap-0.3.0-1794477283958');
const configuration=(await readFile(path.join(work,'configuration'),'utf8')).trim().split(/\r?\n/);
assert.equal(configuration[0],pack.runtimeChecksum); assert.equal(configuration[2],pack.appHash);
async function verify(root,manifestFile) {
  const manifest=await readFile(manifestFile,'utf8'); let count=0; const expected=[];
  for(const line of manifest.trim().split(/\r?\n/)){
    const match=/^([a-f0-9]{64})  (.+)$/.exec(line); assert.ok(match,'BAD_MANIFEST');
    assert.equal(hash(await readFile(path.join(root,match[2]))),match[1],`IMMUTABLE_CHANGED:${match[2]}`); expected.push(match[2]);count++;
  }
  const actual=await files(root); assert.deepEqual(actual.map(item=>item.path).sort(),expected.sort(),'UNEXPECTED_IMMUTABLE_FILE');
  return {files:count,manifestSha256:hash(Buffer.from(manifest))};
}
const runtimeProof=await verify(path.join(runtimeRoot,runtime[0]),path.join(work,'runtime.manifest'));
const appProof=await verify(path.join(runtimeRoot,apps[0]),path.join(work,'app.manifest'));
async function files(root,prefix='') {
  let out=[];for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){
    const rel=prefix?`${prefix}/${entry.name}`:entry.name;
    assert.ok(!entry.isSymbolicLink(),`UNEXPECTED_LINK:${rel}`);
    if(entry.isDirectory())out.push(...await files(root,rel));else out.push({path:rel,sha256:hash(await readFile(path.join(root,rel)))});
  }return out.sort((a,b)=>a.path.localeCompare(b.path));
}
const metadata=path.join(runtimeRoot,'profile/metadata');
const json=(await files(metadata)).filter(item=>item.path.endsWith('.json'));
const db=new DatabaseSync(path.join(metadata,'tasks.sqlite'),{readOnly:true});const tables={};
for(const table of ['tasks','requests','operations']) {const rows=db.prepare(`SELECT * FROM ${table}`).all();tables[table]={count:rows.length,sha256:hash(JSON.stringify(rows))};}db.close();
const gameDirectory=path.join(portable,'OUCL.games');assert.ok((await lstat(gameDirectory)).isDirectory());
const games=await files(gameDirectory);
const ownerPresent=await lstat(path.join(metadata,'owner.lock')).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
const result={label,time:new Date().toISOString(),executable:{bytes:pack.bytes,sha256:pack.sha256},runtime,apps,runtimeProof,appProof,json,tables,games,ownerPresent};
await writeFile(path.join(base,`audit-${label}.json`),JSON.stringify(result,null,2)); console.log(JSON.stringify({label,runtimeFiles:runtimeProof.files,appFiles:appProof.files,json:json.length,tables,gameFiles:games.length,ownerPresent}));
