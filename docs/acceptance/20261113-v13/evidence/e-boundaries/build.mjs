import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const directory = 'acceptance-results/e-boundaries-v13';
const result = await build({ entryPoints: [directory + '/entry.mjs'], bundle: true, platform: 'node', format: 'esm', target: 'node24',
  outfile: directory + '/production.mjs', metafile: true });
const inputs = [];
for (const file of Object.keys(result.metafile.inputs)) inputs.push({ path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
const frozen = JSON.parse(await readFile('FREEZE-MANIFEST.json'));
for (const input of inputs.filter(i => i.path.startsWith('src/'))) {
  const accepted = frozen.files.find(f => path.normalize(f.path) === path.normalize(input.path));
  if (!accepted || accepted.sha256 !== input.sha256) throw new Error('FROZEN_INPUT_MISMATCH:' + input.path);
}
await writeFile(directory + '/source-inputs.json', JSON.stringify({ inputs, bundleSha256: createHash('sha256').update(await readFile(directory + '/production.mjs')).digest('hex') }, null, 2));
