import { build } from 'esbuild';
import { spawn } from 'node:child_process';

await build({ entryPoints: ['tests/handshake.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/handshake.test.mjs' });
const child = spawn(process.execPath, ['--test', '.test-build/handshake.test.mjs'], { stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
