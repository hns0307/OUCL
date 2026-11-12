import { readFile, writeFile, cp, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const frozen = JSON.parse(await readFile('FREEZE-MANIFEST.json','utf8'));
for (const item of frozen.files) assert.equal(await hash(item.path),item.sha256,`SOURCE_DRIFT:${item.path}`);
const product = JSON.parse(await readFile('acceptance-results/product-manifest.json','utf8'));
for (const item of product) for (const root of ['acceptance-results/product','acceptance-results/v5-global/product'])
  assert.equal(await hash(path.join(root,item.path)),item.sha256,`PRODUCT_DRIFT:${root}/${item.path}`);
let exists=true; try {await access('dist');} catch(error) {if(error.code!=='ENOENT')throw error; exists=false;}
if (!exists) await cp('acceptance-results/product','dist',{recursive:true,errorOnExist:true,force:false});
for (const item of product) assert.equal(await hash(path.join('dist',item.path)),item.sha256,`PACKAGE_INPUT_DRIFT:${item.path}`);
const report={status:'PASS',frozenFiles:frozen.files.length,sourceDrift:[],productFiles:product.length,packageInput:'dist',copiedExistingVerifiedBuild:!exists};
await writeFile('acceptance-results/v6-package/preflight.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
