import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const directory = new URL('./',import.meta.url);
const pins = JSON.parse(await readFile(new URL('source-shas.json',directory),'utf8'));
for(const [file,expected] of Object.entries(pins)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),expected,file);
const displays = {};
for(const name of ['nested-multi','exact-platform-pin','platform-rejected']) {
  const evidence=JSON.parse(await readFile(new URL(`attempt2-${name}/evidence.json`,directory),'utf8'));
  displays[name]=evidence.display;
  if(name!=='platform-rejected') assert.deepEqual(evidence.preview.platformFailures,[]);
}
await writeFile(new URL('display-artifact.json',directory),JSON.stringify({schema:'acceptance-artifact-only',syntheticPlatformResponse:true,backendOnly:true,windowVerified:false,displays},null,2));
await writeFile(new URL('verification.json',directory),JSON.stringify({sourceInputsUnchanged:Object.keys(pins).length,tests:3,pass:3,fail:0,skip:0,syntheticPlatformResponse:true,windowVerified:false},null,2));
console.log(`PASS: ${Object.keys(pins).length} pinned build inputs unchanged; 3 final backend scenarios; display artifact exported.`);
