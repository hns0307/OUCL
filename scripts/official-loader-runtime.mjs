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
const child = spawn(electron, [output], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit' });
const [code] = await once(child, 'close');
process.exitCode = code ?? 1;
