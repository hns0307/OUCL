import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const base = path.resolve('docs/work-packages/P-C/evidence/v2a-ui'); await mkdir(base, { recursive: true });
await copyFile('docs/work-packages/P-C/preview-ui-fixture.html', path.join(base, 'index.html'));
await build({ entryPoints: ['docs/work-packages/P-C/preview-ui-fixture.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023',
  outfile: path.join(base, 'renderer.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
await build({ entryPoints: ['docs/work-packages/P-C/preview-ui-entry.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(base, 'entry.cjs') });
await build({ entryPoints: ['src/ipc/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'es2023', external: ['electron'], outfile: path.join(base, 'dist/preload/index.cjs') });
const environment = { ...process.env, OUCL_PC_UI_ROOT: base }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve('docs/work-packages/P-C/preview-ui-electron.cjs')], { env: environment, windowsHide: true, stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code ?? 1; });
