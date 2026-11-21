import { spawn } from 'node:child_process';
import { mkdtemp, access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';

const profile = await mkdtemp(path.resolve('.test-build/loader-local-'));
const environment = { ...process.env, OUCL_LOCAL_LOADER_PROFILE: profile }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve('scripts/electron-loader-local-smoke.cjs')], { env: environment, windowsHide: true, stdio: 'inherit' });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
assert.equal(code, 0);
await assert.rejects(access(path.join(profile, 'metadata/owner.lock')), { code: 'ENOENT' });
const target = path.resolve(process.env.OUCL_VALIDATION_DIR ?? 'docs/validation/LOADER-SELECTION-20261027', 'smoke.json');
const report = JSON.parse(await readFile(target, 'utf8')); report.ownerReleased = true; await writeFile(target, JSON.stringify(report, null, 2));
