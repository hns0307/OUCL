import { mkdtemp, mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { HashPool } from '../.test-build/src/services/workers/hash-pool.js';
import { ObjectStore } from '../.test-build/src/services/objects/store.js';
const workspace=await mkdtemp(path.resolve('.test-build/official-loader-'));
const metadata=path.join(workspace,'metadata'),games=path.join(workspace,'games'),store=path.join(games,'store');
await mkdir(metadata);await mkdir(store,{recursive:true});
const source=process.env.OUCL_DOWNLOAD_TEST_OBJECTS;assert.ok(source&&path.isAbsolute(source)&&source.replaceAll('\\','/').endsWith('/.test-build/download-regression/games/store/objects'));
await cp(source,path.join(store,'objects'),{recursive:true,dereference:false,errorOnExist:true,force:false});
const storage=await StorageClient.open(path.resolve('dist/workers/entry.cjs'),metadata);const hashes=new HashPool(path.resolve('dist/workers/entry.cjs'));let objects;
try{await storage.createInstallation({rootId:randomUUID(),dataDirectory:games});objects=await ObjectStore.open(store,storage,hashes);await objects.rebuildIndex();}
finally{await objects?.close();await hashes.close();await storage.close();}
await writeFile('.test-build/download-loader-workspace.json',JSON.stringify({workspace}));console.log(workspace);

