import { build as bundle } from 'esbuild';
import { build as render } from 'vite';
import path from 'node:path';

const output = path.resolve(process.env.OUCL_BUILD_ROOT ?? 'dist');
await render({ build: { outDir: path.join(output, 'renderer') } });
await bundle({ entryPoints: ['src/main/index.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], outfile: path.join(output, 'main/index.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/ipc/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'es2023', external: ['electron'], outfile: path.join(output, 'preload/index.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/services/workers/entry.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(output, 'workers/entry.cjs'), logLevel: 'info' });
await bundle({ entryPoints: ['src/services/packs/fixed-worker.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(output, 'workers/fixed-pack.cjs'), logLevel: 'info' });
