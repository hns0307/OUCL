import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const base = path.resolve('docs/work-packages/P-C/evidence/v2a-focused');
const output = path.join(base, '.test-build'); const temporary = path.join(base, 'tmp');
await mkdir(temporary, { recursive: true });
async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sources(path.join(directory, entry.name))
    : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path.join(directory, entry.name)] : []))).flat();
}
const selected = ['tests/mod-maintenance-impact.test.ts', 'tests/mod-maintenance-preview.test.ts', 'tests/mod-maintenance-presentation.test.ts',
  'tests/mod-maintenance-jobs.test.ts'];
await build({ entryPoints: [...await sources('src'), ...await sources('tests/fixtures'), ...selected], bundle: false, platform: 'node', format: 'esm',
  target: 'node24', outbase: '.', outdir: output });
const environment = { ...process.env, TMP: temporary, TEMP: temporary, TMPDIR: temporary };
const child = spawn(process.execPath, ['--test', ...selected.map(file => path.join(output, file.replace(/\.ts$/, '.js')))],
  { cwd: base, env: environment, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code ?? 1; });
