import {DatabaseSync} from 'node:sqlite'; import {createHash} from 'node:crypto'; import {readFile,readdir,stat,writeFile} from 'node:fs/promises'; import path from 'node:path';
const base=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const profile=path.join(base,'product-profile'); const metadata=path.join(profile,'metadata');
const hash=data=>createHash('sha256').update(data).digest('hex'); const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const p=path.join(dir,entry.name); if(entry.isDirectory()) await walk(p); else if(entry.name.endsWith('.json')) files.push({path:path.relative(metadata,p),sha256:hash(await readFile(p))});}}
await walk(metadata);
const db=new DatabaseSync(path.join(metadata,'tasks.sqlite'),{readOnly:true}); const tables={};
for(const name of ['tasks','requests','operations']){ const rows=db.prepare(`SELECT * FROM ${name}`).all(); tables[name]={rows:rows.length,sha256:hash(JSON.stringify(rows))}; } db.close();
const samples={};for(const filename of ['OUCL-PE-Forge-Smoke-1.0.0.mrpack','different.mrpack']){const file=path.join(base,filename);samples[filename]=hash(await readFile(file));}
const result={files:files.sort((a,b)=>a.path.localeCompare(b.path)),tables,samples}; await writeFile(path.join(base,`protected-${process.argv[2]}.json`),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
