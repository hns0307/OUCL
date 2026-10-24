import { build as bundle } from 'esbuild';
import { build as render } from 'vite';

await render();
await bundle({ entryPoints: ['src/main/index.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], outfile: 'dist/main/index.cjs', logLevel: 'info' });
await bundle({ entryPoints: ['src/ipc/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'es2023', external: ['electron'], outfile: 'dist/preload/index.cjs', logLevel: 'info' });
