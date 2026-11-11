// Reproduces the repository test/build steps with all generated files inside P-C.
import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const runLabel = process.argv[2] ?? 'v2a';
if (!/^[a-z0-9-]{1,40}$/.test(runLabel)) throw new Error('INVALID_RUN_LABEL');
const output = path.join(repository, 'docs/work-packages/P-C/evidence', runLabel);
const compiled = path.join(output, 'compiled');
await mkdir(path.join(output, '.test-build'), { recursive: true });
const temporary = path.join(output, 'tmp');
await mkdir(temporary, { recursive: true });
// ESLint's relative src/core rules must be rooted at the isolated test cwd too.
await copyFile(path.join(repository, 'eslint.config.mjs'), path.join(output, 'eslint.config.mjs'));
async function typescriptFiles(directory) {
  const entries = await readdir(path.join(repository, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? typescriptFiles(path.join(directory, entry.name))
    : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path.join(directory, entry.name)] : []))).flat();
}
const sources = await typescriptFiles('src'); const tests = await typescriptFiles('tests');
await build({ absWorkingDir: repository, entryPoints: [...sources, ...tests], bundle: false, platform: 'node', format: 'esm',
  target: 'node24', outbase: repository, outdir: compiled });
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: output, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TMP: temporary, TEMP: temporary, TMPDIR: temporary } });
  const savedLog = createWriteStream(path.join(output, 'tests.txt'));
  let log = ''; child.stdout.on('data', value => { log += value; }); child.stderr.on('data', value => { log += value; });
  child.stdout.on('data', value => { savedLog.write(value); }); child.stderr.on('data', value => { savedLog.write(value); });
  child.on('error', reject); child.on('close', code => {
    savedLog.end(() => { resolve({ code, summary: log.slice(-4500) }); });
  });
});
const testResult = await run(['--test', '--test-timeout=120000', '--experimental-test-coverage', '--test-coverage-include=**/src/core/**/*.js',
  '--test-coverage-lines=85', '--test-coverage-branches=85', '--test-coverage-functions=85',
  ...tests.filter(file => file.endsWith('.test.ts')).map(file => path.join(compiled, file.replace(/\.ts$/, '.js')))]);
console.log(testResult.summary);
await buildRenderer({ configFile: path.join(repository, 'vite.config.ts'),
  build: { outDir: path.join(output, 'dist/renderer'), emptyOutDir: true } });
for (const [entry, destination, external] of [
  ['src/main/index.ts', 'main/index.cjs', ['electron']],
  ['src/ipc/preload.ts', 'preload/index.cjs', ['electron']],
  ['src/services/workers/entry.ts', 'workers/entry.cjs', []],
]) {
  await build({ absWorkingDir: repository, entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
    target: 'node24', external, outfile: path.join(output, 'dist', destination) });
}
await writeFile(path.join(output, 'result.json'), JSON.stringify({ testExitCode: testResult.code, isolatedBuild: 'PASS',
  scope: 'current working tree, Node tests and production compilation; no Electron/game execution' }, null, 2));
process.exitCode = testResult.code ?? 1;
