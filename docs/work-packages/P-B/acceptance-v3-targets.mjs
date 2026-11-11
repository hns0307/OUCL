import { build } from 'esbuild';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, 'acceptance-results/b-targets');
const compiled = path.join(output, '.test-build');
await mkdir(path.join(output, 'tmp'), { recursive: true });
async function sources(directory) {
  const entries = await readdir(path.join(repository, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sources(path.join(directory, entry.name))
    : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path.join(directory, entry.name)] : []))).flat();
}
await build({ absWorkingDir: repository, entryPoints: [...await sources('src'), ...await sources('tests/fixtures'),
  'tests/acceptance-task-targets.test.ts'], bundle: false, platform: 'node', format: 'esm', target: 'node24', outbase: repository, outdir: compiled });
const child = spawn(process.execPath, ['--test', '--test-timeout=120000', path.join(compiled, 'tests/acceptance-task-targets.test.js')],
  { cwd: output, env: { ...process.env, TMP: path.join(output, 'tmp'), TEMP: path.join(output, 'tmp') }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', bytes => { process.stdout.write(bytes); log += bytes; });
child.stderr.on('data', bytes => { process.stderr.write(bytes); log += bytes; });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
await writeFile(path.join(output, 'tests.log'), log);
await writeFile(path.join(output, 'result.json'), JSON.stringify({ exitCode: code, scope: 'dedicated target boundaries; no GUI/game/full suite',
  source: repository, test: 'tests/acceptance-task-targets.test.ts' }, null, 2));
process.exitCode = code ?? 1;
