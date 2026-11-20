
import { readFile, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Finds a package through the installed dependency graph, including packages with exports maps. */
export async function packageRoot(name, resolver = require) {
  let directory = path.dirname(await realpath(resolver.resolve(name)));
  for (;;) {
    try {
      if (JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).name === name) return directory;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('PACKAGE_ROOT_NOT_FOUND');
    directory = parent;
  }
}

/** Keeps direct and transitive runtime license notices with both Windows package formats. */
export async function runtimeNotices() {
  const entries = new Map();
  async function collect(name, resolver) {
    if (name.startsWith('@types/')) return;
    const directory = await packageRoot(name, resolver);
    const info = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const id = name + '@' + info.version;
    if (entries.has(id)) return;
    const notices = (await readdir(directory)).filter(file => /^(licen[cs]e|notice|copying)(\.(txt|md))?$/i.test(file));
    if (notices.length === 0) throw new Error('MISSING_RUNTIME_LICENSE: ' + id);
    const texts = await Promise.all(notices.sort().map(file => readFile(path.join(directory, file), 'utf8')));
    entries.set(id, texts.join('\n'));
    const fromPackage = createRequire(path.join(directory, 'package.json'));
    for (const dependency of Object.keys(info.dependencies ?? {})) await collect(dependency, fromPackage);
  }
  for (const name of ['react', 'react-dom', 'zustand', 'smol-toml', '@azure/msal-node', 'skinview3d']) await collect(name, require);
  return Array.from(entries).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, notice]) => '--- ' + name + ' ---\n' + notice).join('\n\n');
}
