import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(base, '../..');
const run = path.join(base, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(run, { recursive: true });
const compiled = await build({ absWorkingDir: repository, stdin: { resolveDir: repository, contents: `
  export {MaintenancePreviewJobs} from './src/services/mods/maintenance-jobs.ts';
  export {presentMaintenancePreview} from './src/services/mods/maintenance-presentation.ts';
  export {isMaintenanceDisplay} from './src/shared/contracts/mod-maintenance-preview.ts';
  export {ModContractError} from './src/shared/contracts/mods.ts';` },
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(base, 'modules.cjs'), metafile: true });
const names = Object.keys(compiled.metafile.inputs).filter(name => name.startsWith('src/'));
names.push(path.relative(repository, path.join(base, 'run.mjs')), path.relative(repository, path.join(base, 'boundaries.test.cjs')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = await Promise.all(names.sort().map(async name => ({ path: name.replaceAll('\\', '/'), sha256: hash(await readFile(path.join(repository, name))) })));
await writeFile(path.join(run, 'source-sha256.json'), JSON.stringify(sources, null, 2));
await writeFile(path.join(run, 'build-metafile.json'), JSON.stringify(compiled.metafile, null, 2));
const child = spawn(process.execPath, ['--test', '--test-timeout=120000', path.join(base, 'boundaries.test.cjs')],
  { cwd: base, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', bytes => { log += bytes; process.stdout.write(bytes); });
child.stderr.on('data', bytes => { log += bytes; process.stderr.write(bytes); });
const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
await writeFile(path.join(run, 'tests.log'), log);
const after = await Promise.all(sources.map(async item => ({ path: item.path, sha256: hash(await readFile(path.join(repository, item.path))) })));
const unchanged = JSON.stringify(after) === JSON.stringify(sources);
await writeFile(path.join(run, 'source-after-sha256.json'), JSON.stringify(after, null, 2));
const summary = { exitCode, unchangedSources: unchanged, run, node: process.version,
  scope: 'New pure tests only; actual production registry/projection/schema, synthetic facts and constructor-injected clock. No Electron/GUI/IPC/disk player data.' };
await writeFile(path.join(run, 'result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary)); process.exitCode = exitCode === 0 && unchanged ? 0 : 1;
