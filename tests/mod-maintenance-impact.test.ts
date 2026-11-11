import assert from 'node:assert/strict';
import test from 'node:test';
import { previewModMaintenance } from '../src/core/mods/maintenance-impact.js';
import type { MaintenanceInventoryFile } from '../src/core/mods/maintenance-impact.js';
import type { ModEnvironment } from '../src/core/mods/check.js';
import type { PlatformModVersion } from '../src/core/mods/platform.js';
import { parseJsonModDeclarations } from '../src/core/mods/json-declarations.js';

const environment: ModEnvironment = { loader: 'fabric', versions: { minecraft: '1.20.1', java: '17', fabricloader: '0.16.14' }, languageVersions: {} };
function file(id: string, fields: Record<string, unknown> = {}, enabled = true): MaintenanceInventoryFile {
  return { fileId: id, enabled, issues: [], archives: [{ entries: [], jarJar: false,
    declarations: [parseJsonModDeclarations('fabric', JSON.stringify({ schemaVersion: 1, id, version: '1', ...fields }))] }],
  platform: { fileId: id, enabled, size: 10, sha1: `${id}-sha1`, sha512: `${id}-sha512`, formats: ['fabric'], unresolvedEmbedded: false } };
}
function sources(files: MaintenanceInventoryFile[]): Map<string, PlatformModVersion> {
  return new Map(files.map(item => [item.platform.sha512!, { projectId: `project-${item.fileId}`, versionId: `version-${item.fileId}`,
    name: item.fileId, versionNumber: '1', release: 'release', publishedAt: '2026-11-10T00:00:00.000Z', loaders: ['fabric'],
    gameVersions: ['1.20.1'], environment: 'client_and_server', dependencies: [],
    files: [{ filename: `${item.fileId}.jar`, size: 10, sha1: item.platform.sha1!, sha512: item.platform.sha512!, url: 'https://example.invalid/file', primary: true }],
    evidence: { url: 'https://example.invalid/metadata', sha256: 'a'.repeat(64) } }]));
}
test('single JAR disable/enable predicts both checks without mutating or aliasing inputs', () => {
  const files = [file('some_mod')]; const versions = sources(files); const initial = structuredClone(files);
  const disabled = previewModMaintenance(files, environment, versions, 'some_mod', 'disable');
  assert.equal(disabled.state, 'ready'); assert.equal(disabled.after.local.providers.length, 0);
  assert.deepEqual(files, initial);
  disabled.affectedProviders[0]!.via.push('changed'); assert.deepEqual(files, initial);
  files[0]!.enabled = false; files[0]!.platform.enabled = false;
  assert.equal(previewModMaintenance(files, environment, versions, 'some_mod', 'enable').state, 'ready');
});
test('required reverse closure includes aliases and cycles; optional edges remain informational', () => {
  const files = [file('base_mod', { provides: ['base_alias'], depends: { top_mod: '*' } }),
    file('middle_mod', { depends: { base_alias: '*' } }), file('top_mod', { depends: { middle_mod: '*' } }),
    file('optional_mod', { recommends: { base_alias: '*' } })];
  const impact = previewModMaintenance(files, environment, sources(files), 'base_mod', 'disable');
  assert.equal(impact.state, 'blocked'); assert.deepEqual(impact.directRequiredBy, ['middle_mod']);
  assert.deepEqual(impact.transitiveRequiredBy, ['top_mod']);
  assert.ok(impact.affectedProviders.some(provider => provider.id === 'base_alias'));
  assert.ok(impact.relations.some(edge => edge.optional && edge.dependentFileId === 'optional_mod'));
  assert.ok(impact.introducedIssues.some(finding => finding.issue.code === 'MOD_DEPENDENCY_MISSING'));
});
test('all declarations and declared nested providers move with their physical root; stray nested archives do not', () => {
  const root = file('outer_mod', { jars: [{ file: 'nested.jar' }] });
  root.archives[0]!.declarations[0]!.mods.push(file('second_mod').archives[0]!.declarations[0]!.mods[0]!);
  root.archives.push({ ...file('nested_mod').archives[0]!, entries: ['nested.jar'] });
  root.archives.push({ ...file('stray_mod').archives[0]!, entries: ['stray.jar'] });
  const files = [root, file('consumer_mod', { depends: { nested_mod: '*', second_mod: '*' } })];
  const impact = previewModMaintenance(files, environment, sources(files), 'outer_mod', 'disable');
  assert.deepEqual(impact.affectedProviders.map(provider => provider.id).sort(), ['nested_mod', 'outer_mod', 'second_mod']);
  assert.deepEqual(impact.directRequiredBy, ['consumer_mod']);
  assert.ok(impact.relations.some(edge => edge.selector === 'nested_mod'));
});
test('platform exact version reverse links stay separate from local Mod IDs', () => {
  const files = [file('base_mod'), file('consumer_mod'), file('top_mod')]; const versions = sources(files);
  versions.get('consumer_mod-sha512')!.dependencies = [{ projectId: null, versionId: 'version-base_mod', filename: null, type: 'required' }];
  versions.get('top_mod-sha512')!.dependencies = [{ projectId: 'project-consumer_mod', versionId: null, filename: null, type: 'required' }];
  const impact = previewModMaintenance(files, environment, versions, 'base_mod', 'disable');
  assert.equal(impact.state, 'blocked'); assert.deepEqual(impact.directRequiredBy, ['consumer_mod']);
  assert.deepEqual(impact.transitiveRequiredBy, ['top_mod']);
  assert.ok(impact.introducedIssues.some(finding => finding.scope === 'platform' && finding.issue.code === 'PLATFORM_DEPENDENCY_MISSING'));
  assert.ok(impact.relations.every(edge => edge.scope === 'platform'));
});
test('enabling detects conflicts, aliases, runtime mismatch and missing platform source', () => {
  const files = [file('base_mod'), file('new_mod', { provides: ['base_mod'], depends: { java: '>=21' } }, false)];
  const impact = previewModMaintenance(files, environment, sources(files), 'new_mod', 'enable');
  assert.equal(impact.state, 'blocked');
  assert.ok(impact.introducedIssues.some(finding => finding.issue.code === 'DUPLICATE_MOD_ID'));
  assert.ok(impact.introducedIssues.some(finding => finding.issue.code === 'DEPENDENCY_VERSION_MISMATCH'));
  const unknown = [file('unknown_mod', {}, false)];
  assert.equal(previewModMaintenance(unknown, environment, new Map(), 'unknown_mod', 'enable').state, 'unknown');
});
test('pre-existing broken or unknown inventory remains blocking even when the action removes the finding', () => {
  const files = [file('broken_mod', { depends: { missing_mod: '*' } })];
  const impact = previewModMaintenance(files, environment, sources(files), 'broken_mod', 'disable');
  assert.equal(impact.state, 'blocked'); assert.ok(impact.resolvedIssues.some(finding => finding.issue.code === 'MOD_DEPENDENCY_MISSING'));
  assert.equal(impact.after.platform.state, 'satisfied');
  files[0]!.archives = [];
  assert.equal(previewModMaintenance(files, environment, sources(files), 'broken_mod', 'disable').state, 'unknown');
});
test('rejects missing/ambiguous targets, mismatched activation snapshots and over-budget inventory', () => {
  const item = file('some_mod');
  for (const files of [[item, item], [{ ...item, platform: { ...item.platform, enabled: false } }],
    [{ ...item, platform: { ...item.platform, fileId: 'other_mod' } }], Array(257).fill(item)]) {
    assert.throws(() => previewModMaintenance(files, environment, new Map(), 'some_mod', 'disable'), /INVALID_MAINTENANCE_SNAPSHOT/);
  }
  assert.throws(() => previewModMaintenance([item], environment, sources([item]), 'missing_mod', 'disable'), /INVALID_MAINTENANCE_TARGET/);
  assert.throws(() => previewModMaintenance([item], environment, sources([item]), 'some_mod', 'enable'), /INVALID_MAINTENANCE_TARGET/);
});
test('relation overflow is explicit and cannot produce a ready preview', () => {
  const base = file('base_mod'); const files = [base, ...Array.from({ length: 24 }, (_, index) => file(`consumer_${index}`,
    { depends: Object.fromEntries(Array.from({ length: 24 }, (_, provider) => [`consumer_${provider}`, '*'])) }))];
  const impact = previewModMaintenance(files, environment, sources(files), 'base_mod', 'disable');
  assert.equal(impact.truncated, true); assert.equal(impact.relations.length, 512); assert.equal(impact.state, 'unknown');
});
test('server-only declarations cannot borrow a same-ID client provider to create reverse edges', () => {
  const mixed = file('mixed_mod');
  mixed.archives[0]!.declarations[0]!.mods.push(file('mixed_mod', { environment: 'server', depends: { base_mod: '*' } })
    .archives[0]!.declarations[0]!.mods[0]!);
  const files = [file('base_mod'), mixed];
  const result = previewModMaintenance(files, environment, sources(files), 'base_mod', 'disable');
  assert.deepEqual(result.directRequiredBy, []); assert.equal(result.state, 'ready');
});
test('runtime requirements never bind to spoofed JAR provider identities', () => {
  const files = [file('java'), file('consumer_mod', { depends: { java: '>=17' } })];
  const result = previewModMaintenance(files, environment, sources(files), 'java', 'disable');
  assert.equal(result.state, 'blocked'); assert.deepEqual(result.directRequiredBy, []);
  assert.ok(result.resolvedIssues.some(finding => finding.issue.code === 'DUPLICATE_MOD_ID'));
});
