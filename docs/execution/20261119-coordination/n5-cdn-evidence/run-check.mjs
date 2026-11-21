import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';

const base = path.dirname(fileURLToPath(import.meta.url));
const evidence = await mkdtemp(path.join(base, 'run-'));
await mkdir(path.resolve('tmp'), { recursive: true });
const temporary = await mkdtemp(path.resolve('tmp/n5-cdn-'));
const fixture = path.join(base, 'electron-check.cjs');
const adapter = path.join(temporary, 'adapter.cjs');
const profile = path.join(temporary, 'profile');
const adapterSource = path.resolve('src/main/online-tools.ts');
const resultPath = path.join(evidence, 'result.json');
const logPath = path.join(evidence, 'electron.log');
const sha256 = async filename => createHash('sha256').update(await readFile(filename)).digest('hex');
const status = { evidence, temporary, profile, adapterSource, fixture, adapter, resultPath, node: process.version };
console.log(evidence);
try {
  await mkdir(profile);
  await build({ entryPoints: [adapterSource], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: adapter });
  status.sourceSha256 = await sha256(adapterSource);
  status.adapterSha256 = await sha256(adapter);
  status.fixtureSha256 = await sha256(fixture);
  const env = { ...process.env, OUCL_N5_CDN_PROFILE: profile, OUCL_N5_CDN_ADAPTER: adapter, OUCL_N5_CDN_RESULT: resultPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [fixture, '--disable-background-networking'];
  status.electronCommand = { executable: electron, args };
  const child = spawn(electron, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stderr.on('data', chunk => chunks.push(chunk));
  try {
    status.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  } finally {
    await writeFile(logPath, Buffer.concat(chunks));
  }
  if (status.exitCode !== 0) process.exitCode = status.exitCode ?? 1;
} catch (cause) {
  status.error = cause instanceof Error ? cause.message : String(cause);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(evidence, 'status.json'), JSON.stringify(status, null, 2) + '\n');
}
