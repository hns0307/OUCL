import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import electron from 'electron';

// Run only the existing dedicated official-loader validation fixtures, with current source and production worker.
const mode = process.argv[2] ?? 'install';
if (!['install', 'launch', 'test-mod'].includes(mode)) throw new Error('INVALID_RUNTIME_MODE');
const output = path.resolve(`.test-build/official-loader-${mode}-final.mjs`);
await build({ entryPoints: [`tests/runtime/official-loader-${mode}.ts`], outfile: output, bundle: true,
  platform: 'node', format: 'esm', target: 'node24', external: ['electron'] });
const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
let entry = output;
if (process.env.OUCL_LOADER_TEST_SYSTEM_NETWORK === '1') {
  delete environment.ELECTRON_RUN_AS_NODE;
  entry = path.resolve('.test-build/official-loader-desktop.cjs');
  await writeFile(entry, `const {app}=require('electron');app.disableHardwareAcceleration();app.whenReady().then(()=>import(${JSON.stringify(pathToFileURL(output).href)})).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});`);
}
const child = spawn(electron, [entry], { env: environment, windowsHide: true, stdio: 'inherit' });
const [code] = await once(child, 'close');
process.exitCode = code ?? 1;
