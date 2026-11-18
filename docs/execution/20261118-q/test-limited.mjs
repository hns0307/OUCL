import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

async function typescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => entry.isDirectory() ? typescriptFiles(path.join(directory, entry.name))
    : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path.join(directory, entry.name)] : []));
  return groups.flat();
}
const sources = await typescriptFiles('src');
const testSources = await typescriptFiles('tests');
const tests = testSources.filter(file => file.endsWith('.test.ts'));
// Work packages can verify without replacing another chat's compiled tests or fixture roots.
const testRoot = path.resolve(process.env.OUCL_TEST_ROOT ?? '.');
const output = path.join(testRoot, '.test-build');
await mkdir(output, { recursive: true });
let environment = process.env;
if (process.env.OUCL_TEST_ROOT) {
  const temporary = path.join(testRoot, 'tmp'); await mkdir(temporary, { recursive: true });
  environment = { ...process.env, TMP: temporary, TEMP: temporary, OUCL_SOURCE_ROOT: process.cwd() };
}
await build({ entryPoints: [...sources, ...testSources], bundle: false, platform: 'node', format: 'esm', target: 'node24', outbase: '.', outdir: output });
const child = spawn(process.execPath, ['--test', '--test-concurrency=4', '--experimental-test-coverage', '--test-coverage-include=**/src/core/**/*.js',
  '--test-coverage-lines=85', '--test-coverage-branches=85', '--test-coverage-functions=85',
  ...tests.map(file => path.join(output, file.replace(/\.ts$/, '.js')))], { stdio: 'inherit', cwd: testRoot, env: environment });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
