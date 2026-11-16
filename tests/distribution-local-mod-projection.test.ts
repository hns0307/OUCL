import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { projectDistributionMods } from '../src/services/distribution/local-mod-projection.js';
import { parseDistributionPlan, transactionDigest } from '../src/services/distribution/transaction-record.js';
import { parseDistributionManifest } from '../src/core/distribution/manifest.js';
import type { DistributionOperation } from '../src/core/distribution/manifest.js';
import { parseJsonModDeclarations } from '../src/core/mods/json-declarations.js';
import { checkLocalMods } from '../src/core/mods/check.js';
import { plannedModFacts } from '../src/services/mods/facts.js';
import { modInventoryFingerprint } from '../src/services/mods/inventory.js';
import type { ModArchiveScan } from '../src/services/mods/archive.js';

const instanceId = randomUUID();
function scan(id: string, depends: Record<string, string> = {}, variant = ''): ModArchiveScan {
  const body = JSON.stringify({ schemaVersion: 1, id, version: '1.0.0', environment: 'client', depends });
  const bytes = body + variant; const hash = (algorithm: string): string => createHash(algorithm).update(bytes).digest('hex');
  return { size: Buffer.byteLength(bytes), sha1: hash('sha1'), sha256: hash('sha256'), sha512: hash('sha512'),
    archives: [{ entries: [], sha256: hash('sha256'), documents: [{ name: 'fabric.mod.json', body }], declarations: [parseJsonModDeclarations('fabric', body)] }] };
}
function plan(operations: DistributionOperation[]) {
  const manifest = parseDistributionManifest({ formatVersion: 1, packageId: 'pack', packageVersion: '1', target: {
    minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14' }, operations });
  return parseDistributionPlan({ formatVersion: 1, txId: randomUUID(), rootId: randomUUID(), instanceId, instanceRevision: 1,
    sourceId: 'synthetic', packageId: 'pack', packageVersion: '1', sequence: 1, manifestSha256: transactionDigest(manifest), manifest });
}
const item = (filename: string, facts = scan('fixture_mod')) => plannedModFacts(instanceId, filename, facts);
const add = (path: string, facts: ModArchiveScan): Extract<DistributionOperation, { kind: 'add' }> => ({ kind: 'add', area: 'mods', path, artifactId: 'local', sha256: facts.sha256, size: facts.size });
const code = (value: string) => ({ code: value });

test('replacement removes the exact old item once and creates the complete expected fingerprint without aliasing', () => {
  const old = item('old.jar'); const fresh = scan('replacement_mod'); const untouched = item('personal.jar', scan('personal_mod'));
  const input = { plan: plan([{ ...add('old.jar', fresh), kind: 'replace' as const, managedId: randomUUID(), expectedSha256: old.sha256! }]),
    baseline: [old, untouched], scans: [{ operationIndex: 0, scan: fresh }] };
  const before = structuredClone(input); const result = projectDistributionMods(input);
  assert.equal(result.items.length, 2); assert.equal(result.items.filter(row => row.filename === 'old.jar').length, 1);
  assert.equal(result.items.find(row => row.filename === 'old.jar')!.sha256, fresh.sha256);
  assert.equal(result.fingerprint, modInventoryFingerprint(instanceId, 1, result.items)); assert.deepEqual(input, before);
  result.items[0]!.archives[0]!.entries.push('mutation.jar'); assert.deepEqual(input, before);
});

test('remove leaves remaining dependency declarations intact for a separate complete compatibility check', () => {
  const provider = item('provider.jar', scan('provider_mod')); const consumer = item('consumer.jar', scan('consumer_mod', { provider_mod: '*' }));
  const result = projectDistributionMods({ plan: plan([{ kind: 'remove', area: 'mods', path: provider.filename, managedId: randomUUID(), expectedSha256: provider.sha256! }]), baseline: [provider, consumer], scans: [] });
  const environment = { loader: 'fabric' as const, versions: { minecraft: '1.20.1', java: '17.0.1', fabricloader: '0.16.14' }, languageVersions: {} };
  assert.equal(checkLocalMods([provider, consumer], environment).state, 'satisfied');
  const assessment = checkLocalMods(result.items, environment); assert.equal(assessment.state, 'unsatisfied');
  assert.ok(assessment.issues.some(issue => issue.code === 'MOD_DEPENDENCY_MISSING')); assert.deepEqual(result.items, [consumer]);
});

test('keep, disabled and omitted inventory items are preserved without adopting new facts', () => {
  const kept = item('kept.jar'); const omitted = item('personal.jar', scan('personal_mod'));
  const disabled = { ...item('disabled.jar.disabled', scan('disabled_mod')), enabled: false };
  const baseline = [kept, omitted, disabled];
  const result = projectDistributionMods({ plan: plan([{ kind: 'keep', area: 'mods', path: kept.filename }]), baseline, scans: [] });
  assert.deepEqual(result.items, baseline); assert.notEqual(result.items[0], kept); assert.equal(result.items[2]!.enabled, false);
});

test('occupied case-folded filenames, duplicate baseline names and unknown hashes are rejected', () => {
  const facts = scan('fixture_mod'); const existing = item('Name.jar', facts);
  assert.throws(() => projectDistributionMods({ plan: plan([add('name.jar', facts)]), baseline: [existing], scans: [{ operationIndex: 0, scan: facts }] }), code('NAME_CONFLICT'));
  assert.throws(() => projectDistributionMods({ plan: plan([]), baseline: [existing, item('name.jar', facts)], scans: [] }), code('NAME_CONFLICT'));
  assert.throws(() => projectDistributionMods({ plan: plan([]), baseline: [{ ...existing, sha256: null }], scans: [] }), code('UNKNOWN_FACTS'));
  assert.throws(() => projectDistributionMods({ plan: plan([]), baseline: [{ ...existing, fileId: 'a'.repeat(64) }], scans: [] }), code('INVALID_INPUT'));
});

test('replace and remove require the exact baseline hash, while projection never grants managed ownership', () => {
  const old = item('old.jar'); const fresh = scan('new_mod');
  for (const kind of ['replace', 'remove'] as const) {
    const operation: DistributionOperation = kind === 'remove' ? { kind, area: 'mods', path: old.filename, managedId: randomUUID(), expectedSha256: 'a'.repeat(64) }
      : { ...add(old.filename, fresh), kind, managedId: randomUUID(), expectedSha256: 'a'.repeat(64) };
    assert.throws(() => projectDistributionMods({ plan: plan([operation]), baseline: [old], scans: kind === 'replace' ? [{ operationIndex: 0, scan: fresh }] : [] }), code('OLD_HASH_MISMATCH'));
  }
  const result = projectDistributionMods({ plan: plan([{ kind: 'remove', area: 'mods', path: old.filename, managedId: randomUUID(), expectedSha256: old.sha256! }]), baseline: [old], scans: [] });
  assert.deepEqual(result.items, []); // A matching hash projects bytes; the arbitrary managedId is not authenticated here.
});

test('missing, repeated, extra and cross-index scan facts fail without changing the baseline', () => {
  const first = scan('first_mod'); const second = scan('second_mod'); const selected = plan([add('one.jar', first), add('two.jar', second)]);
  assert.throws(() => projectDistributionMods({ plan: selected, baseline: [], scans: [{ operationIndex: 0, scan: first }] }), code('SCAN_BINDING'));
  assert.throws(() => projectDistributionMods({ plan: selected, baseline: [], scans: [{ operationIndex: 0, scan: first }, { operationIndex: 0, scan: first }] }), code('SCAN_BINDING'));
  assert.throws(() => projectDistributionMods({ plan: selected, baseline: [], scans: [{ operationIndex: 0, scan: second }, { operationIndex: 1, scan: first }] }), code('ARTIFACT_MISMATCH'));
  assert.throws(() => projectDistributionMods({ plan: plan([{ kind: 'keep', area: 'mods', path: 'keep.jar' }]), baseline: [], scans: [{ operationIndex: 0, scan: first }] }), code('SCAN_BINDING'));
  assert.throws(() => projectDistributionMods({ plan: selected, baseline: [], scans: [{ operationIndex: 3, scan: first }] }), code('SCAN_BINDING'));
});

test('unsafe paths, nested target paths and non-Mod operations are not treated as supported', () => {
  const facts = scan('fixture_mod');
  for (const operation of [{ ...add('nested/mod.jar', facts) }, { ...add('pack.jar', facts), area: 'resourcepacks' as const }, { kind: 'keep' as const, area: 'config' as const, path: 'settings.txt' }]) {
    assert.throws(() => projectDistributionMods({ plan: plan([operation]), baseline: [], scans: [] }), code('UNSUPPORTED_OPERATION'));
  }
  const bad = plan([]); bad.manifest.operations = [add('../escape.jar', facts)];
  assert.throws(() => projectDistributionMods({ plan: bad, baseline: [], scans: [] }), code('INVALID_INPUT'));
  const unsafe = item('safe.jar'); unsafe.filename = '../unsafe.jar';
  assert.throws(() => projectDistributionMods({ plan: plan([]), baseline: [unsafe], scans: [] }), code('INVALID_INPUT'));
});

test('scan size, hashes and strict worker fact shapes must match the selected operation', () => {
  const facts = scan('fixture_mod');
  assert.throws(() => projectDistributionMods({ plan: plan([add('new.jar', facts)]), baseline: [], scans: [{ operationIndex: 0, scan: { ...facts, size: facts.size + 1 } }] }), code('ARTIFACT_MISMATCH'));
  assert.throws(() => projectDistributionMods({ plan: plan([add('new.jar', facts)]), baseline: [], scans: [{ operationIndex: 0, scan: { ...facts, sha1: 'unknown' } }] }), code('INVALID_INPUT'));
  const result = projectDistributionMods({ plan: plan([add('new.jar', facts)]), baseline: [], scans: [{ operationIndex: 0, scan: facts }] });
  assert.deepEqual(result.items, [item('new.jar', facts)]);
});

test('the full final inventory is limited to 256 files and all supplied facts to 8MiB', () => {
  const facts = scan('fixture_mod'); const baseline = Array.from({ length: 256 }, (_, index) => item(`file-${index}.jar`, facts));
  assert.equal(projectDistributionMods({ plan: plan([]), baseline, scans: [] }).items.length, 256);
  assert.throws(() => projectDistributionMods({ plan: plan([add('extra.jar', facts)]), baseline, scans: [{ operationIndex: 0, scan: facts }] }), code('FACT_LIMIT'));
  assert.throws(() => projectDistributionMods({ plan: plan([]), baseline: [...baseline, item('extra.jar')], scans: [] }), code('FACT_LIMIT'));
  const oversized = structuredClone(facts); oversized.archives[0]!.documents[0]!.body = 'x'.repeat(8 * 1024 ** 2);
  assert.throws(() => projectDistributionMods({ plan: plan([add('new.jar', facts)]), baseline: [], scans: [{ operationIndex: 0, scan: oversized }] }), code('FACT_LIMIT'));
});
