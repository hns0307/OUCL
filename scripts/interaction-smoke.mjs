import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';

const testDirectory = path.resolve('.test-build');
await mkdir(testDirectory, { recursive: true });
const profile = await mkdtemp(path.join(testDirectory, 'interaction-'));
const evidence = path.resolve(process.env.OUCL_VALIDATION_DIR ?? path.join(profile, 'evidence'));
const environment = { ...process.env, OUCL_INTERACTION_PROFILE: profile, OUCL_VALIDATION_DIR: evidence };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.OUCL_PORTABLE_ROOT;
for (let pass = 1; pass <= 2; pass++) {
  const child = spawn(electron, [path.resolve('scripts/electron-interaction-smoke.cjs')], { env: { ...environment, OUCL_INTERACTION_PASS: String(pass) }, windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(code, 0);
  const report = JSON.parse(await readFile(path.join(evidence, `pass-${pass}.json`), 'utf8')); assert.equal(report.status, 'PASS');
  await assert.rejects(access(path.join(profile, 'metadata/owner.lock')), { code: 'ENOENT' });
}
