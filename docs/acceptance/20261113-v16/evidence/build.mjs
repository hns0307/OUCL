import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const out = new URL('./', import.meta.url);
await mkdir(out, { recursive: true });
const exports = ['services/mods/inventory','services/mods/inspection','services/mods/modrinth','services/mods/maintenance-preview','services/mods/maintenance-presentation','services/workers/mod-archive-reader'];
const source = exports.map(p => `export * from '../../src/${p}.ts';`).join('\n') + "\nexport { modZip } from '../../tests/fixtures/mod-zip.ts';";
await writeFile(new URL('entry.ts', out), source);
const options = { bundle: true, platform: 'node', target: 'node24', metafile: true, packages: 'external' };
const main = await build({ ...options, entryPoints: [new URL('entry.ts', out).pathname.replace(/^\/(\w:)/,'$1')], outfile: new URL('chain.mjs',out).pathname.replace(/^\/(\w:)/,'$1'), format: 'esm' });
const worker = await build({ ...options, entryPoints: ['src/services/workers/entry.ts'], outfile: new URL('worker.cjs',out).pathname.replace(/^\/(\w:)/,'$1'), format: 'cjs' });
const pins = {};
for (const filename of new Set([...Object.keys(main.metafile.inputs), ...Object.keys(worker.metafile.inputs)])) {
  pins[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
}
await writeFile(new URL('source-shas.json',out), JSON.stringify(pins,null,2));
await writeFile(new URL('build-meta.json',out),JSON.stringify({main:main.metafile,worker:worker.metafile},null,2));
console.log(`Pinned ${Object.keys(pins).length} inputs; built independent backend and original worker entry.`);
