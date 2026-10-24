import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
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
await build({ entryPoints: [...sources, ...testSources], bundle: false, platform: 'node', format: 'esm', target: 'node24', outbase: '.', outdir: '.test-build' });
const child = spawn(process.execPath, ['--test', '--experimental-test-coverage', '--test-coverage-include=**/src/core/**/*.js',
  '--test-coverage-lines=85', '--test-coverage-branches=85', '--test-coverage-functions=85',
  ...tests.map(file => path.join('.test-build', file.replace(/\.ts$/, '.js')))], { stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
