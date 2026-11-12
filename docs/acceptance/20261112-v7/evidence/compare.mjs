import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base='acceptance-results/v6-package';
const labels=['before-picker','after-fixed','after-cancel','after-mismatch','cold-closed','hot-opened','hot-fixed','hot-closed','final-strict'];
const audits=await Promise.all(labels.map(async label=>JSON.parse(await readFile(`${base}/audit-${label}.json`,'utf8'))));
for(const audit of audits)for(const key of ['executable','runtime','apps','runtimeProof','appProof','json','tables','games'])assert.deepEqual(audit[key],audits[0][key],`CHANGED:${audit.label}:${key}`);
assert.equal(audits.find(a=>a.label==='cold-closed').ownerPresent,false);assert.equal(audits.find(a=>a.label==='hot-closed').ownerPresent,false);
const exits=await Promise.all(['cold','hot'].map(async label=>JSON.parse(await readFile(`${base}/${label}-exit.json`,'utf8'))));
for(const exit of exits){assert.equal(exit.exitCode,0);assert.equal(exit.hasExited,true);}
const samples=[['OUCL-PE-Forge-Smoke-1.0.0.mrpack','e4cf7d5607a70582cfcec200a381892a83c75e122f5be6bad926de23ff7278f2'],['different.mrpack','7f81fd6f3a5bd8344d030e15c144bba0ed80e8ab8b1eb8f0025eb196458b092b']];
for(const [name,digest] of samples)assert.equal(createHash('sha256').update(await readFile(`acceptance-results/${name}`)).digest('hex'),digest);
const result={status:'PASS',auditLabels:labels,protectedFields:['json','tables','games'],samples:samples.map(([name,sha256])=>({name,sha256})),exits,
scope:'Final EXE empty portable root, fixed sample read-only preview; Chromium caches excluded; no populated player-data claim; no general import or game run.'};
await writeFile(`${base}/comparison.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
