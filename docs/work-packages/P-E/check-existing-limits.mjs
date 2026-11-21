// Read-only production-logic probe. Bundles remain inside the P-E evidence folder.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, '../../..');
const sources = ['src/core/mods/dependency-graph.ts', 'src/services/mods/candidates.ts',
  'src/services/resources/service.ts', 'src/services/storage/resources.ts'];
const output = path.join(packageRoot, 'evidence/20261110/existing-limits.bundle.mjs');
await build({ stdin: { contents: sources.map(source => `export * from './${source}';`).join('\n'),
  resolveDir: repoRoot, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: output });
const { inspectDependencyGraph, snapshotModCandidateInput, ResourceService, parseResourceLibrary } = await import(pathToFileURL(output).href);
const version = i => ({ projectId: `p${String(i).padStart(7, '0')}`, versionId: `v${String(i).padStart(7, '0')}`,
  name: 'fixture', versionNumber: '1', release: 'release', publishedAt: '2026-01-01T00:00:00Z',
  loaders: ['forge'], gameVersions: ['1.20.1'], environment: 'client_and_server', dependencies: [],
  files: [{ filename: `mod${i}.jar`, size: 1, sha1: 'a'.repeat(40), sha512: 'a'.repeat(128),
    url: `https://cdn.modrinth.com/data/p${String(i).padStart(7, '0')}/mod.jar`, primary: true }],
  evidence: { url: 'https://api.modrinth.com/v2/version/example', sha256: 'b'.repeat(64) } });
const base = { minecraft: '1.20.1', loader: 'forge', unknownInstalled: false };
const results = [];
for (const count of [255, 256, 257]) {
  const selected = Array.from({ length: count }, (_, i) => version(i));
  // One root fan-out isolates the node limit from the separate root-count limit.
  selected[0].dependencies = selected.slice(1).map(row => ({ projectId: row.projectId,
    versionId: row.versionId, type: 'required', filename: null }));
  const result = inspectDependencyGraph({ ...base, selected, installed: [], roots: [selected[0].versionId] });
  assert.equal(result.state, count <= 256 ? 'resolved' : 'unknown');
  if (count > 256) assert.ok(result.issues.some(row => row.code === 'PROJECT_LIMIT'));
  results.push({ case: `graph fan-out ${count}`, state: result.state, nodes: result.nodes.length,
    codes: result.issues.map(row => row.code) });
}
for (const count of [31, 32, 33]) {
  const selected = Array.from({ length: count }, (_, i) => version(i));
  for (let i = 0; i < count - 1; i++) selected[i].dependencies = [{ projectId: selected[i + 1].projectId,
    versionId: selected[i + 1].versionId, type: 'required', filename: null }];
  const result = inspectDependencyGraph({ ...base, selected, installed: [], roots: [selected[0].versionId] });
  assert.equal(result.state, count <= 32 ? 'resolved' : 'unknown');
  results.push({ case: `chain nodes ${count}`, state: result.state, nodes: result.nodes.length,
    codes: result.issues.map(row => row.code) });
}
for (const count of [15, 16, 17]) {
  const input = { ...base, installed: [], selections: {}, roots: Array.from({ length: count }, (_, i) => version(i).versionId) };
  if (count <= 16) snapshotModCandidateInput(input);
  else assert.throws(() => snapshotModCandidateInput(input), error => error.code === 'INVALID_ARGUMENT');
  results.push({ case: `candidate roots ${count}`, state: count <= 16 ? 'accepted' : 'INVALID_ARGUMENT' });
}
// Admission-only mocks: no task acceptance, transfer, persistence, or worker runs.
for (const count of [511, 512]) {
  let selections = 0;
  const history = Array.from({ length: count }, () => ({ projectId: 'old00000', versionId: 'old00000',
    spec: { expected: { digest: 'a'.repeat(40) } } }));
  const storage = { readInstallation: async () => ({ data: { rootId: '00000000-0000-4000-8000-000000000001' } }),
    readResources: async () => ({ data: { rootId: '00000000-0000-4000-8000-000000000001', items: history } }) };
  const service = new ResourceService(storage, {}, { select: async () => { selections++; throw new Error('METADATA_SENTINEL'); } });
  await assert.rejects(service.download('00000000-0000-4000-8000-000000000002',
    { projectId: 'uXXizFIs', versionId: 'DG5Fn9Sz', fileId: 'b'.repeat(40) }),
  error => count === 511 ? error.message === 'METADATA_SENTINEL' : error.code === 'UNAVAILABLE');
  assert.equal(selections, count === 511 ? 1 : 0);
  results.push({ case: `history admission ${count}`, state: count === 511 ? 'reaches metadata' : 'UNAVAILABLE', metadataCalls: selections });
}
assert.throws(() => parseResourceLibrary({ rootId: '00000000-0000-4000-8000-000000000001',
  items: Array(513).fill(null) }), error => error.code === 'INVALID_RECORD');
results.push({ case: 'history parser 513', state: 'INVALID_RECORD before row parsing' });
const hashes = await Promise.all(sources.map(async source => ({ source,
  sha256: createHash('sha256').update(await readFile(path.join(repoRoot, source))).digest('hex') })));
await writeFile(path.join(packageRoot, 'evidence/20261110/existing-limits-results.json'),
  JSON.stringify({ scope: 'real graph, input validator, resource admission with mocks and length parser; no persistence or network',
    passed: results.length, failed: 0, sourceHashes: hashes, results }, null, 2) + '\n');
process.stdout.write(`PASS ${results.length}: production graph and candidate-input boundaries; no network or instance writes.\n`);
