import { build as bundle } from 'esbuild';
import { build as render } from 'vite';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const output = path.resolve(process.env.OUCL_BUILD_ROOT ?? 'dist');
await render({ build: { outDir: path.join(output, 'renderer') } });
await bundle({ entryPoints: ['src/main/index.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], outfile: path.join(output, 'main/index.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/ipc/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'es2023', external: ['electron'], outfile: path.join(output, 'preload/index.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/services/workers/entry.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(output, 'workers/entry.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/services/web/archive-worker.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(output, 'workers/web-archive.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/services/multiplayer/archive-worker.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(output, 'main/multiplayer-archive.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/services/packs/fixed-worker.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(output, 'workers/fixed-pack.cjs'), logLevel: 'info' });
if (process.platform === 'win32' && process.arch === 'x64') {
  const native = spawnSync(process.execPath, ['scripts/build-distribution-files.mjs'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, OUCL_BUILD_ROOT: output } });
  if (native.error || native.status !== 0) throw new Error('DISTRIBUTION_HELPER_BUILD_FAILED');
  const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const room = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/utf8output',
    '/out:' + path.join(output, 'main/oucl-room-process.exe'), path.resolve('src/services/multiplayer/RoomProcess.cs')], {
    stdio: 'inherit', windowsHide: true,
  });
  if (room.error || room.status !== 0) throw new Error('MULTIPLAYER_HELPER_BUILD_FAILED');
}
