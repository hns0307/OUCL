import { build } from 'file:///D:/MC_start/OUCL/node_modules/esbuild/lib/main.js';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = 'D:/MC_start/OUCL/tmp/execution-baseline-20261115';
async function files(dir) { return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(x => x.isDirectory() ? files(path.join(dir,x.name)) : x.name.endsWith('.ts') && !x.name.endsWith('.d.ts') ? [path.join(dir,x.name)] : []))).flat(); }
await mkdir(path.join(root,'tmp'),{recursive:true});
await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
await build({entryPoints:[...await files('src'),...await files('tests')],bundle:false,platform:'node',format:'esm',target:'node24',outbase:'.',outdir:path.join(root,'.test-build')});
console.log('Compiled baseline services and tests into exclusive root');

