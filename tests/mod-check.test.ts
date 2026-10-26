import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLocalMods } from '../src/core/mods/check.js';
import type { LocalModFile, ModEnvironment } from '../src/core/mods/check.js';
import { parseJsonModDeclarations } from '../src/core/mods/json-declarations.js';
import { parseTomlModDeclarations } from '../src/core/mods/toml-declarations.js';
const environment: ModEnvironment = { loader: 'fabric', versions: { minecraft: '1.20.1', java: '17.0.9', fabricloader: '0.16.14' }, languageVersions: {} };
function file(id: string, fields: Record<string, unknown> = {}): LocalModFile {
  return { fileId: id, enabled: true, issues: [], archives: [{ entries: [], jarJar: false,
    declarations: [parseJsonModDeclarations('fabric', JSON.stringify({ schemaVersion: 1, id, version: '1', ...fields }))] }] };
}
test('local checks distinguish runtime dependencies, aliases, disabled files and exact requirements', () => {
  const consumer = file('consumer_mod', { depends: { minecraft: '1.20.1', java: '>=17', fabricloader: '>=0.16', provided_mod: '=2' },
    recommends: { optional_mod: '*' }, breaks: { bad_mod: '*' } });
  const provider = file('library_mod', { version: '2', provides: ['provided_mod'] });
  assert.equal(checkLocalMods([consumer, provider], environment).state, 'satisfied');
  const missing = checkLocalMods([consumer, { ...provider, enabled: false }], environment);
  assert.equal(missing.state, 'unsatisfied'); assert.equal(missing.issues[0]!.code, 'MOD_DEPENDENCY_MISSING');
  assert.equal(missing.issues[0]!.dependencyId, 'provided_mod');
  assert.equal(checkLocalMods([consumer, file('library_mod', { version: '3', provides: ['provided_mod'] })], environment).issues[0]!.code, 'DEPENDENCY_VERSION_MISMATCH');
  const noRuntime = checkLocalMods([consumer, provider], { ...environment, versions: {} });
  assert.ok(noRuntime.issues.some(issue => issue.code === 'RUNTIME_DEPENDENCY_MISSING'));
});
test('duplicate identities, alias collisions and conflicts are explicit; optional present versions still validate', () => {
  const duplicate = checkLocalMods([file('some_mod'), file('other_mod', { provides: ['some_mod'] })], environment);
  assert.equal(duplicate.state, 'unsatisfied'); assert.equal(duplicate.issues.filter(issue => issue.code === 'DUPLICATE_MOD_ID').length, 2);
  assert.equal(checkLocalMods([file('java')], environment).state, 'unsatisfied');
  const consumer = file('consumer_mod', { recommends: { optional_mod: '>=2' }, breaks: { bad_mod: '<2' }, conflicts: { warning_mod: '*' } });
  const result = checkLocalMods([consumer, file('optional_mod'), file('bad_mod'), file('warning_mod')], environment);
  assert.ok(result.issues.some(issue => issue.code === 'MOD_CONFLICT')); assert.ok(result.issues.some(issue => issue.code === 'MOD_DISCOURAGED'));
  assert.ok(result.issues.some(issue => issue.code === 'DEPENDENCY_VERSION_MISMATCH'));
  assert.equal(checkLocalMods([file('consumer_mod', { depends: { duplicate_mod: '*' } }), file('duplicate_mod'), file('duplicate_mod')], environment).state, 'unsatisfied');
});
test('only declared client nested JARs satisfy dependencies, with paths preserved as evidence', () => {
  const root = file('outer_mod', { jars: [{ file: 'nested.jar' }], depends: { inner_mod: '*' } });
  root.archives.push({ ...file('inner_mod').archives[0]!, entries: ['nested.jar'] });
  root.archives.push({ ...file('unrelated_mod').archives[0]!, entries: ['unrelated.jar'] });
  const result = checkLocalMods([root], environment); assert.equal(result.state, 'satisfied');
  assert.deepEqual(result.providers.find(item => item.id === 'inner_mod')!.via, ['nested.jar']);
  assert.ok(!result.providers.some(item => item.id === 'unrelated_mod'));
  assert.equal(checkLocalMods([{ ...root, archives: [root.archives[0]!] }], environment).state, 'unsatisfied');
  assert.ok(checkLocalMods([{ ...root, archives: [root.archives[0]!] }], environment).issues.some(issue => issue.code === 'NESTED_DECLARATION_MISSING'));
  const server = file('server_mod', { environment: 'server', jars: [{ file: 'nested.jar' }] }); server.archives.push(root.archives[1]!);
  const serverResult = checkLocalMods([server], environment); assert.equal(serverResult.providers.length, 0); assert.equal(serverResult.issues[0]!.code, 'SERVER_ONLY_MOD');
});
test('unknown versions, formats, unreadable files and unsupported expressions cannot pass', () => {
  assert.equal(checkLocalMods([file('some_mod', { version: '${version}' })], environment).state, 'unknown');
  assert.equal(checkLocalMods([file('some_mod', { environment: 'other' })], environment).state, 'unknown');
  assert.equal(checkLocalMods([{ ...file('some_mod'), issues: ['ARCHIVE_IO'] }], environment).state, 'unknown');
  assert.equal(checkLocalMods([{ ...file('some_mod'), archives: [] }], environment).state, 'unknown');
  assert.equal(checkLocalMods([{ ...file('some_mod'), archives: [{ entries: [], declarations: [], jarJar: false }] }], environment).state, 'unknown');
  assert.equal(checkLocalMods([file('some_mod')], { ...environment, loader: 'vanilla' }).issues[0]!.code, 'LOADER_MISMATCH');
  const invalid = file('some_mod', { depends: { java: '>=17 && <22' } });
  assert.equal(checkLocalMods([invalid], environment).state, 'unknown');
  assert.equal(checkLocalMods([file('some_mod', { depends: { java: '*' } })], { ...environment, versions: { java: null } }).state, 'unknown');
  assert.equal(checkLocalMods([file('some_mod', { depends: { other_mod: {} } }), file('other_mod')], environment).state, 'unknown');
});
test('Forge multi-Mod and separate FML/NeoForge versions retain side and JarJar unknowns', () => {
  const facts = parseTomlModDeclarations('neoforge', 'modLoader="javafml"\nloaderVersion="[3,4)"\n[[mods]]\nmodId="some_mod"\nversion="1"\n'
    + '[[dependencies.some_mod]]\nmodId="neoforge"\nversionRange="[21.1,22)"\n'
    + '[[dependencies.some_mod]]\nmodId="server_mod"\nside="SERVER"\n'
    + '[[dependencies.some_mod]]\nmodId="unknown_mod"\nside="unknown"');
  const local = { fileId: 'some_mod', enabled: true, issues: [], archives: [{ entries: [], declarations: [facts], jarJar: true }] };
  const env: ModEnvironment = { loader: 'neoforge', versions: { neoforge: '21.1.265' }, languageVersions: { javafml: '3' } };
  const report = checkLocalMods([local], env); assert.equal(report.state, 'unknown');
  assert.ok(report.issues.some(issue => issue.code === 'JARJAR_SELECTION_REQUIRES_CHECK'));
  assert.ok(report.issues.some(issue => issue.code === 'UNKNOWN_DEPENDENCY_ENVIRONMENT'));
  assert.ok(!report.issues.some(issue => issue.dependencyId === 'server_mod'));
  assert.ok(checkLocalMods([local], { ...env, languageVersions: {} }).issues.some(issue => issue.code === 'LANGUAGE_REQUIREMENT' && issue.severity === 'unknown'));
  assert.ok(checkLocalMods([local], { ...env, languageVersions: { javafml: '2' } }).issues.some(issue => issue.code === 'LANGUAGE_REQUIREMENT' && issue.severity === 'error'));
  facts.mods[0]!.issues.push('UNKNOWN_VERSION'); assert.ok(checkLocalMods([local], env).issues.some(issue => issue.code === 'UNKNOWN_VERSION'));
});
test('Quilt prefers its own declaration, supports Fabric fallback and preserves unresolved conditions', () => {
  assert.equal(checkLocalMods([file('some_mod')], { ...environment, loader: 'quilt' }).state, 'satisfied');
  const q = file('fabric_mod'); const facts = parseJsonModDeclarations('quilt', JSON.stringify({ schema_version: 1,
    quilt_loader: { id: 'quilt_mod', group: 'org.example', version: '1', depends: [{ id: 'some_mod', unless: 'other_mod', optional: true }] } }));
  q.archives[0]!.declarations.push(facts); const report = checkLocalMods([q], { ...environment, loader: 'quilt' });
  assert.equal(report.state, 'unknown'); assert.equal(report.providers[0]!.id, 'quilt_mod');
  assert.ok(report.issues.some(issue => issue.code === 'UNKNOWN_UNLESS_CONDITION'));
});
test('instance and nested limits report unknown rather than silently truncating into success', () => {
  assert.equal(checkLocalMods(Array.from({ length: 257 }, (_, i) => ({ ...file('some_mod'), fileId: String(i), enabled: false })), environment).state, 'unknown');
  const deep = file('some_mod'); deep.archives = Array.from({ length: 65 }, () => deep.archives[0]!);
  assert.equal(checkLocalMods([deep], environment).state, 'unknown');
  const crowded = Array.from({ length: 256 }, (_, i) => file(`mod_${i}`, { depends: Object.fromEntries(Array.from({ length: 32 }, (_, j) => [`missing_${j}`, '*'])) }));
  const report = checkLocalMods(crowded, environment); assert.equal(report.issues.length, 4096);
  assert.equal(report.issues.at(-1)!.code, 'REPORT_LIMIT'); assert.equal(report.state, 'unsatisfied');
});
