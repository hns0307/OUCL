import { cp, mkdir, readFile, readdir, stat, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('WINDOWS_X64_REQUIRED');
const meta = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(meta.version)) throw new Error('INVALID_VERSION');
const tag = process.env.OUCL_BUILD_TAG ?? '';
if (tag && !/^[a-z][a-z0-9-]{0,39}$/.test(tag)) throw new Error('INVALID_BUILD_TAG');
const artifactVersion = `${meta.version}${tag ? `-${tag}` : ''}`;
const work = path.resolve('.test-build', `bootstrap-${meta.version}-${Date.now()}`); await mkdir(work, { recursive: true });
const app = path.join(work, 'app'); await mkdir(app);
const buildRoot = path.resolve(process.env.OUCL_BUILD_ROOT ?? 'dist');
await cp(buildRoot, path.join(app, 'dist'), { recursive: true });
await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'oucl', version: meta.version, main: 'dist/main/index.cjs' }));
const require = createRequire(import.meta.url);
// Follow Node's actual installed resolution, including parent pnpm stores and packages that hide package.json exports.
async function packageRoot(name, resolver = require) {
  let directory = path.dirname(await realpath(resolver.resolve(name)));
  while (true) {
    try { if (JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).name === name) return directory; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('PACKAGE_ROOT_NOT_FOUND');
    directory = parent;
  }
}
const notices = [];
for (const name of ['react', 'react-dom', 'zustand', 'smol-toml']) notices.push(`--- ${name} ---\n${await readFile(path.join(await packageRoot(name), 'LICENSE'), 'utf8')}`);
const fromReact = createRequire(path.join(await packageRoot('react-dom'), 'package.json'));
notices.push(`--- scheduler ---\n${await readFile(path.join(await packageRoot('scheduler', fromReact), 'LICENSE'), 'utf8')}`);
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
const electronRoot = await packageRoot('electron');
const runtimeManifest = (await manifest(path.join(electronRoot, 'dist'))).join('\n') + '\n';
const appHash = createHash('sha256').update(appManifest).digest('hex');
await writeFile(path.join(work, 'app.manifest'), appManifest); await writeFile(path.join(work, 'runtime.manifest'), runtimeManifest);
const version = JSON.parse(await readFile(path.join(electronRoot, 'package.json'), 'utf8')).version;
const filename = `electron-v${version}-win32-x64.zip`;
const checksum = JSON.parse(await readFile(path.join(electronRoot, 'checksums.json'), 'utf8'))[filename];
if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('MISSING_OFFICIAL_CHECKSUM');
await writeFile(path.join(work, 'configuration'), `${checksum}\nhttps://github.com/electron/electron/releases/download/v${version}/${filename}\n${appHash}\n`);
function run(file, args, env = process.env) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, env });
  if (result.error || result.status !== 0) throw new Error('BOOTSTRAP_BUILD_FAILED');
}
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', await readFile('bootstrap/package.ps1', 'utf8')],
  { ...process.env, OUCL_APP_SOURCE: app, OUCL_APP_ZIP: path.join(work, 'app.zip') });
await mkdir('release', { recursive: true });
const output = path.resolve('release', `OUCL-${artifactVersion}.exe`);
try { await access(output); throw new Error('RELEASE_ALREADY_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
run(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', `/out:${output}`,
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
  '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  `/resource:${path.join(work, 'configuration')},configuration`, `/resource:${path.join(work, 'app.manifest')},app-manifest`,
  `/resource:${path.join(work, 'runtime.manifest')},runtime-manifest`, `/resource:${path.join(work, 'app.zip')},application`, path.resolve('bootstrap/Launcher.cs')]);
const report = { version: meta.version, output, bytes: (await stat(output)).size, sha256: createHash('sha256').update(await readFile(output)).digest('hex'), electron: version, runtimeChecksum: checksum, appHash };
const evidence = `docs/validation/BOOTSTRAP-${artifactVersion}`;
await mkdir(evidence, { recursive: true });
await writeFile(path.join(evidence, 'package.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
