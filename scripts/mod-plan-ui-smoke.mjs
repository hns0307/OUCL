import { build } from 'esbuild';
import { cp, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';

const directory = await mkdtemp(path.resolve('.test-build/mod-plan-ui-'));
await build({ entryPoints: ['tests/runtime/mod-plan-ui.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023',
  outfile: path.join(directory, 'renderer.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
await cp('tests/runtime/mod-plan-ui.html', path.join(directory, 'index.html'));
const environment = { ...process.env, OUCL_MOD_PLAN_UI_ROOT: directory }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve('scripts/electron-mod-plan-ui.cjs')], { env: environment, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error.code ?? 'ELECTRON_START_FAILED'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
