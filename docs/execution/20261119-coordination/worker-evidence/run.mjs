import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(evidence, '../../../..');
const builds = path.resolve(repository, '../..', 'tmp');
await mkdir(builds, { recursive: true });
const testRoot = await mkdtemp(path.join(builds, 'fixed-pack-20261119-'));
const worker = path.join(builds, '20261118-x-final-build/dist/workers/fixed-pack.cjs');
const suite = path.join(builds, '20261118-x-final-tests/.test-build/tests/fixed-pack-preview.test.js');
const sample = path.join(repository, 'docs/work-packages/P-E/sample/OUCL-PE-Forge-Smoke-1.0.0.mrpack');
const inputs = {};
for (const [key, file] of Object.entries({ worker, suite, sample })) {
  const bytes = await readFile(file);
  inputs[key] = { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const args = [
  '--test',
  '--test-reporter=spec',
  '--test-name-pattern=^(real worker accepts fixed bytes and rejects a different archive|worker exit, duplicate messages, cancellation and deadlines are enforced)$',
  suite,
];
const environment = { OUCL_SOURCE_ROOT: repository, OUCL_FIXED_PACK_WORKER: worker, OUCL_FIXED_PACK_TMP: testRoot };
const log = await open(path.join(evidence, 'tests.log'), 'wx');
const started = new Date().toISOString();
const child = spawn(process.execPath, args, { cwd: testRoot, env: { ...process.env, ...environment }, stdio: ['ignore', log.fd, log.fd] });
try {
  const exitCode = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  await writeFile(path.join(evidence, 'status.json'), JSON.stringify({
    executable: process.execPath, node: process.version, args, testRoot, environment, inputs, started,
    ended: new Date().toISOString(), exitCode,
  }, null, 2) + '\n', { flag: 'wx' });
  process.exitCode = exitCode ?? 1;
} finally { await log.close(); }
