import { cp, mkdir, readFile, readdir, stat, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('WINDOWS_X64_REQUIRED');
const meta = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(meta.version)) throw new Error('INVALID_VERSION');
const work = path.resolve('.test-build', `bootstrap-${meta.version}-${Date.now()}`); await mkdir(work, { recursive: true });
const app = path.join(work, 'app'); await mkdir(app);
await cp('dist', path.join(app, 'dist'), { recursive: true });
await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'oucl', version: meta.version, main: 'dist/main/index.cjs' }));
const notices = [];
for (const name of ['react', 'react-dom', 'zustand']) notices.push(`--- ${name} ---\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`);
const fromReact = createRequire(await realpath('node_modules/react-dom/package.json'));
notices.push(`--- scheduler ---\n${await readFile(path.join(path.dirname(fromReact.resolve('scheduler/package.json')), 'LICENSE'), 'utf8')}`);
await writeFile(path.join(app, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
async function manifest(directory, prefix = '') {
  const lines = [];
  for (const item of (await readdir(path.join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error('LINK_IN_PACKAGE');
    if (item.isDirectory()) lines.push(...await manifest(directory, relative));
    else lines.push(`${createHash('sha256').update(await readFile(path.join(directory, relative))).digest('hex')}  ${relative}`);
  }
  return lines;
}
const appManifest = (await manifest(app)).join('\n') + '\n';
const runtimeManifest = (await manifest(path.resolve('node_modules/electron/dist'))).join('\n') + '\n';
const appHash = createHash('sha256').update(appManifest).digest('hex');
await writeFile(path.join(work, 'app.manifest'), appManifest); await writeFile(path.join(work, 'runtime.manifest'), runtimeManifest);
const version = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version;
const filename = `electron-v${version}-win32-x64.zip`;
const checksum = JSON.parse(await readFile('node_modules/electron/checksums.json', 'utf8'))[filename];
if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('MISSING_OFFICIAL_CHECKSUM');
await writeFile(path.join(work, 'configuration'), `${checksum}\nhttps://github.com/electron/electron/releases/download/v${version}/${filename}\n${appHash}\n`);
function run(file, args, env = process.env) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, env });
  if (result.error || result.status !== 0) throw new Error('BOOTSTRAP_BUILD_FAILED');
}
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', await readFile('bootstrap/package.ps1', 'utf8')],
  { ...process.env, OUCL_APP_SOURCE: app, OUCL_APP_ZIP: path.join(work, 'app.zip') });
await mkdir('release', { recursive: true });
const output = path.resolve('release', `OUCL-${meta.version}.exe`);
try { await access(output); throw new Error('RELEASE_ALREADY_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
run(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', `/out:${output}`,
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
  '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  `/resource:${path.join(work, 'configuration')},configuration`, `/resource:${path.join(work, 'app.manifest')},app-manifest`,
  `/resource:${path.join(work, 'runtime.manifest')},runtime-manifest`, `/resource:${path.join(work, 'app.zip')},application`, path.resolve('bootstrap/Launcher.cs')]);
const report = { version: meta.version, output, bytes: (await stat(output)).size, sha256: createHash('sha256').update(await readFile(output)).digest('hex'), electron: version, runtimeChecksum: checksum, appHash };
const evidence = `docs/validation/BOOTSTRAP-${meta.version}`;
await mkdir(evidence, { recursive: true });
await writeFile(path.join(evidence, 'package.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
