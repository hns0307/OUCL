import { spawn } from 'node:child_process';
import electron from 'electron';
import { mkdtemp, lstat, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const profile = await mkdtemp(path.join(tmpdir(), 'oucl-smoke-'));
const environment = { ...process.env, OUCL_SMOKE_PROFILE: profile };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve('scripts/electron-smoke.cjs')], { stdio: 'inherit', windowsHide: true, env: environment });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => {
  void cleanup(profile).then(() => { process.exitCode = code ?? 1; }).catch(error => { console.error(error); process.exitCode = 1; });
});

async function cleanup(entry) {
  const relative = path.relative(profile, entry);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(profile).startsWith('oucl-smoke-')) throw new Error('OUTSIDE_SMOKE_PROFILE');
  const info = await lstat(entry);
  if (info.isSymbolicLink() || !info.isDirectory()) return unlink(entry);
  for (const name of await readdir(entry)) await cleanup(path.join(entry, name));
  await rmdir(entry);
}
