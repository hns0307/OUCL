import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyDeclarations, modClient, modNested, modRange, modVersion } from '../src/core/mods/declarations.js';
import { parseJsonModDeclarations as json } from '../src/core/mods/json-declarations.js';
import { parseTomlModDeclarations as toml } from '../src/core/mods/toml-declarations.js';
import { modManifestVersion } from '../src/core/mods/manifest.js';
const fabric = (extra: Record<string, unknown> = {}): string => JSON.stringify({ schemaVersion: 1, id: 'outer_mod', version: '1.2.3', ...extra });
const quilt = (extra: Record<string, unknown> = {}, root: Record<string, unknown> = {}): string => JSON.stringify({ schema_version: 1,
  quilt_loader: { group: 'org.example', id: 'outer_mod', version: '1.2.3', ...extra }, ...root });
const forge = 'modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="first_mod"\nversion="1.0"\n';

test('known jarVersion substitution uses only the actual main-section manifest with continuations', () => {
  assert.equal(modManifestVersion('Manifest-Version: 1.0\r\nImplementation-Version: 6.0.\r\n 1\r\n\r\nName: class\r\nImplementation-Version: 99'), '6.0.1');
  assert.equal(modManifestVersion('Implementation-Version: 2\r\rName: section\rImplementation-Version: 99'), '2');
  const body = forge.replace('version="1.0"', 'version="${file.jarVersion}"');
  const facts = toml('forge', body, 'Manifest-Version: 1.0\nImplementation-Version: 6.0.1\n\n');
  assert.equal(facts.mods[0]!.version, '6.0.1'); assert.deepEqual(facts.mods[0]!.issues, []);
  for (const manifest of [undefined, 'x'.repeat(65537), '\0', ' orphan', 'invalid', 'Bad Key: x',
    'Implementation-Version: 1\nimplementation-version: 2', 'Implementation-Version: ${file.version}', 'Manifest-Version: 1.0\n\nImplementation-Version: 99']) {
    assert.equal(modManifestVersion(manifest), null);
    assert.equal(toml('forge', body, manifest).mods[0]!.version, null);
  }
  assert.equal(toml('forge', body.replace('${file.jarVersion}', '${unknown}'), 'Implementation-Version: 1').mods[0]!.version, null);
});

test('Fabric declarations preserve real IDs, aliases, exact constraints, nested JARs and client applicability', () => {
  const facts = json('fabric', fabric({ name: 'Example', provides: ['provided_mod'], environment: 'client', jars: [{ file: 'nested/dep.jar' }],
    depends: { minecraft: ['1.20.1', '1.20.2'], java: '>=17', fabricloader: '>=0.16' },
    recommends: { library_mod: '*' }, suggests: { optional_mod: '*' }, breaks: { bad_mod: '<2' }, conflicts: { warning_mod: '*' } }));
  const mod = facts.mods[0]!; assert.equal(mod.id, 'outer_mod'); assert.equal(mod.name, 'Example'); assert.equal(mod.version, '1.2.3');
  assert.deepEqual(mod.provides, [{ id: 'provided_mod', version: '1.2.3' }]); assert.deepEqual(facts.nested, ['nested/dep.jar']);
  assert.deepEqual(mod.dependencies[0]!.range, ['1.20.1', '1.20.2']);
  assert.deepEqual(mod.dependencies.map(item => item.kind), ['required', 'required', 'required', 'optional', 'optional', 'incompatible', 'discouraged']);
  assert.equal(mod.client, 'yes'); assert.deepEqual(mod.issues, []); assert.deepEqual(facts.issues, []);
  assert.equal(json('fabric', fabric({ environment: 'server' })).mods[0]!.client, 'no');
});
test('Quilt declarations retain aliases, optional requirements and unknown unless/alternative/plugin conditions', () => {
  const facts = json('quilt', quilt({ metadata: { name: 'Quilt Example' }, jars: ['nested/dep.jar'],
    provides: ['provided_mod', { id: 'other_mod', version: '3.0' }], plugins: ['custom'],
    depends: ['some_mod', { id: 'library_mod', versions: { all: ['>=1', { any: ['<2', '=3'] }] }, optional: true },
      { id: 'conditional_mod', unless: 'other_mod' }, ['one_mod', 'two_mod'], 'group:qualified_mod'],
    breaks: [{ id: 'bad_mod', versions: '<3', environment: 'dedicated_server' }] }, { minecraft: { environment: 'dedicated_server' } }));
  const mod = facts.mods[0]!; assert.equal(mod.name, 'Quilt Example'); assert.equal(mod.client, 'no');
  assert.equal(mod.provides[1]!.version, '3.0'); assert.equal(mod.dependencies[1]!.kind, 'optional');
  assert.deepEqual(mod.dependencies[1]!.range, { all: ['>=1', { any: ['<2', '=3'] }] });
  assert.ok(mod.dependencies[2]!.issues.includes('UNKNOWN_UNLESS_CONDITION')); assert.equal(mod.dependencies[3]!.client, 'no');
  assert.ok(mod.issues.includes('UNKNOWN_LOADER_PLUGIN')); assert.ok(mod.issues.includes('UNKNOWN_DEPENDENCY_ALTERNATIVES'));
  assert.ok(mod.issues.includes('UNKNOWN_DEPENDENCY_ID')); assert.deepEqual(facts.nested, ['nested/dep.jar']);
});
test('malformed, unknown, variable and invalid JSON metadata remains explicitly unresolved', () => {
  for (const format of ['fabric', 'quilt'] as const) {
    for (const body of ['not json', '[]', '{}', 'x'.repeat(1024 ** 2 + 1)]) assert.ok(json(format, body).issues.length > 0);
  }
  assert.ok(json('fabric', fabric({ schemaVersion: 99 })).issues.includes('UNKNOWN_SCHEMA'));
  assert.ok(json('fabric', fabric({ id: '../bad' })).issues.includes('MALFORMED_DECLARATION'));
  const facts = json('fabric', fabric({ version: '${version}', environment: 'unknown', provides: [{ id: 'fabric_object_is_invalid' }],
    jars: [{ file: '../bad.jar' }], depends: { 'invalid:id': '*', some_mod: { all: ['*'] }, another_mod: 3 } }));
  assert.equal(facts.mods[0]!.version, null); assert.equal(facts.mods[0]!.client, 'unknown');
  assert.ok(facts.issues.includes('UNKNOWN_VERSION')); assert.ok(facts.issues.includes('UNKNOWN_NESTED_JARS'));
  assert.ok(facts.mods[0]!.issues.includes('UNKNOWN_PROVIDES')); assert.equal(facts.mods[0]!.dependencies[0]!.range, null);
  for (const value of [null, {}, Array(129).fill('a')]) assert.ok(json('fabric', fabric({ provides: value })).mods[0]!.issues.includes('UNKNOWN_PROVIDES'));
  assert.deepEqual(json('fabric', fabric({ provides: [] })).mods[0]!.issues, []);
  for (const value of [null, [], 3]) assert.ok(json('fabric', fabric({ depends: value })).mods[0]!.issues.includes('UNKNOWN_DEPENDENCIES'));
  const q = json('quilt', quilt({ group: 'invalid/group', provides: [{ id: 'provided_mod', version: '${var}' }], depends: [
    { id: 'some_mod', versions: null, optional: 'yes', environment: 'other' }, { id: 'another_mod', versions: {} }] }));
  assert.ok(q.issues.includes('UNKNOWN_GROUP')); assert.ok(q.mods[0]!.issues.includes('UNKNOWN_VERSION'));
  assert.ok(q.mods[0]!.dependencies[0]!.issues.includes('UNKNOWN_OPTIONAL_CONDITION'));
  assert.ok(q.mods[0]!.dependencies[0]!.issues.includes('UNKNOWN_ENVIRONMENT'));
  assert.ok(q.mods[0]!.dependencies[1]!.issues.includes('UNKNOWN_RANGE'));
  assert.ok(json('quilt', quilt({ depends: {} })).mods[0]!.issues.includes('UNKNOWN_DEPENDENCIES'));
});
test('standard TOML parses multi-Mod and preserves Forge language, Java, server-only and optional dependencies', () => {
  const facts = toml('forge', forge + 'displayName="First Mod"\nfeatures={java_version="[17,)",custom="x"}\n'
    + '[[mods]]\nmodId="second_mod"\nversion="${file.jarVersion}"\n'
    + '[[dependencies.first_mod]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20.1]"\n'
    + '[[dependencies.second_mod]]\nmodId="some_mod"\nmandatory=false\nside="SERVER"\n');
  assert.deepEqual(facts.language, { id: 'javafml', range: '[47,)' }); assert.equal(facts.mods.length, 2);
  assert.equal(facts.mods[0]!.name, 'First Mod'); assert.equal(facts.mods[0]!.dependencies[0]!.range, '[1.20.1]');
  assert.equal(facts.mods[0]!.dependencies[1]!.id, 'java'); assert.ok(facts.mods[0]!.issues.includes('UNKNOWN_FEATURE'));
  assert.equal(facts.mods[1]!.version, null); assert.deepEqual(facts.mods[1]!.issues, ['UNKNOWN_VERSION']);
  assert.equal(facts.mods[1]!.dependencies[0]!.kind, 'optional'); assert.equal(facts.mods[1]!.dependencies[0]!.client, 'no');
  assert.equal(facts.mods[1]!.dependencies[0]!.range, '*');
  assert.equal(toml('forge', forge.replace('version="1.0"', '')).mods[0]!.version, '1');
});
test('NeoForge type defaults and incompatible/discouraged requirements remain distinct', () => {
  const facts = toml('neoforge', forge + ['required', 'optional', 'incompatible', 'discouraged'].map(type =>
    `[[dependencies.first_mod]]\nmodId="${type}_mod"\ntype="${type}"\nversionRange="[1,2)"\nside="CLIENT"\n`).join('')
    + '[[dependencies.first_mod]]\nmodId="default_mod"\n');
  assert.deepEqual(facts.mods[0]!.dependencies.map(dep => dep.kind), ['required', 'optional', 'incompatible', 'discouraged', 'required']);
  assert.equal(facts.mods[0]!.dependencies[4]!.range, '*'); assert.deepEqual(facts.issues, []);
});
test('TOML unknown conditions, duplicate fields and malformed structures never produce a clean report', () => {
  for (const body of ['bad=', 'mods=3', '[[mods]]\nmodId="bad-id"', 'x'.repeat(1024 ** 2 + 1)]) assert.ok(toml('forge', body).issues.length > 0);
  assert.ok(toml('forge', forge + 'version="duplicate"').issues.includes('MALFORMED_DECLARATION'));
  assert.ok(toml('forge', forge.replace('modLoader="javafml"', '')).issues.includes('UNKNOWN_LANGUAGE_LOADER'));
  assert.ok(toml('forge', forge.replace('javafml', 'custom')).issues.includes('UNKNOWN_LANGUAGE_LOADER'));
  assert.ok(toml('forge', forge.replace('[47,)', '${loader}')).issues.includes('UNKNOWN_LANGUAGE_RANGE'));
  for (const extra of ['features=3', 'features={java_version=3}']) assert.ok(toml('forge', forge + extra).mods[0]!.issues.length
    || toml('forge', forge + extra).mods[0]!.dependencies.some(dep => dep.issues.length));
  assert.ok(toml('forge', forge + '[dependencies]\nfirst_mod=3').mods[0]!.issues.includes('UNKNOWN_DEPENDENCIES'));
  assert.ok(toml('forge', forge + '[[dependencies.first_mod]]\nmodId="bad-id"').mods[0]!.issues.includes('UNKNOWN_DEPENDENCY_ID'));
  assert.ok(toml('forge', forge + '[[dependencies.unknown_mod]]\nmodId="some_mod"').issues.includes('UNKNOWN_DEPENDENCY_OWNER'));
  const unknown = toml('forge', forge + '[[dependencies.first_mod]]\nmodId="some_mod"\nversionRange=3\nside="WHAT"\nordering="OTHER"').mods[0]!.dependencies[0]!;
  assert.equal(unknown.range, null); assert.equal(unknown.client, 'unknown');
  assert.deepEqual(unknown.issues, ['UNKNOWN_REQUIREMENT', 'UNKNOWN_RANGE', 'UNKNOWN_ENVIRONMENT', 'UNKNOWN_ORDERING']);
  const order = toml('neoforge', forge + '[[dependencies.first_mod]]\nmodId="some_mod"\ntype="newtype"\nordering="AFTER"').mods[0]!.dependencies[0]!;
  assert.deepEqual(order.issues, ['UNKNOWN_REQUIREMENT', 'ORDERING_REQUIRES_CHECK']);
});
test('shared metadata limits bound recursion, tree size and unsafe nested paths', () => {
  assert.deepEqual(emptyDeclarations('fabric'), { format: 'fabric', mods: [], nested: [], language: null, issues: [] });
  for (const value of [null, [], { any: [] }, { all: 3 }, { other: ['1'] }, { any: ['1'], all: ['2'] }, '${version}', 'x'.repeat(2049)]) assert.equal(modRange(value), null);
  assert.equal(modRange('*', 17), null); assert.equal(modRange('*', 0, { nodes: 256 }), null);
  assert.equal(modRange(Array(129).fill('*')), null); assert.deepEqual(modRange({ all: ['1', { any: ['2'] }] }), { all: ['1', { any: ['2'] }] });
  const issues: string[] = []; assert.equal(modVersion('', issues), null); assert.equal(modVersion('1', issues), '1');
  assert.deepEqual(modNested(undefined, false, issues), []); assert.deepEqual(modNested(3, false, issues), []);
  assert.deepEqual(modNested(['a.jar', 'a.jar', 'bad.txt', '../bad.jar'], false, issues), ['a.jar']);
  assert.equal(modClient(undefined, 'server'), 'yes'); assert.equal(modClient('*', 'server'), 'yes');
  assert.equal(modClient('server', 'server'), 'no'); assert.equal(modClient(['client'], 'server'), 'unknown');
});
