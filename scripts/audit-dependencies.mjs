import { readdir, readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const installed = path.resolve('node_modules/.pnpm');
const packages = new Map();
let installedBytes = 0;

async function measure(directory) {
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name);
    const info = await lstat(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) await measure(file);
    else installedBytes += info.size;
  }
}
async function record(directory) {
  try {
    const json = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (typeof json.name === 'string' && typeof json.version === 'string') packages.set(`${json.name}@${json.version}`, { name: json.name, version: json.version, license: json.license ?? 'UNKNOWN' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const slot of await readdir(installed)) {
  const directory = path.join(installed, slot, 'node_modules');
  let names;
  try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
  for (const name of names) {
    const entry = path.join(directory, name);
    if ((await lstat(entry)).isSymbolicLink()) continue;
    if (name.startsWith('@')) {
      for (const nested of await readdir(entry)) {
        const scoped = path.join(entry, nested);
        if (!(await lstat(scoped)).isSymbolicLink()) await record(scoped);
      }
    } else await record(entry);
  }
}
await measure(installed);
const allowed = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', '0BSD', 'BlueOak-1.0.0', '(MIT OR Apache-2.0)', '(MIT AND Zlib)']);
const all = [...packages.values()].sort((a,b) => a.name.localeCompare(b.name));
// These reviewed MPL packages are build-only Vite dependencies, not app payload.
const reviewedBuildOnly = new Set(['lightningcss@1.33.0', 'lightningcss-win32-x64-msvc@1.33.0']);
const unknown = all.filter(item => typeof item.license !== 'string'
  || (!allowed.has(item.license) && !(item.license === 'MPL-2.0' && reviewedBuildOnly.has(`${item.name}@${item.version}`))));
if (all.length === 0) throw new Error('NO_INSTALLED_PACKAGE_EVIDENCE');
const evidence = process.env.OUCL_DEPENDENCY_EVIDENCE ?? 'docs/validation/P0-08';
await mkdir(evidence, { recursive: true });
await writeFile(path.join(evidence, 'licenses.json'), JSON.stringify({ timestamp: new Date().toISOString(), installedBytes, packages: all, reviewedBuildOnly: [...reviewedBuildOnly], reviewRequired: unknown }, null, 2));
console.log(JSON.stringify({ packageCount: all.length, installedBytes, reviewRequired: unknown }));
if (unknown.length > 0) process.exitCode = 1;
