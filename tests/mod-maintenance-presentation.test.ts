import assert from 'node:assert/strict';
import test from 'node:test';
import type { MaintenancePreview } from '../src/services/mods/maintenance-preview.js';
import { presentMaintenancePreview } from '../src/services/mods/maintenance-presentation.js';

const fileId = 'a'.repeat(64); const otherId = 'b'.repeat(64);
function fixture(): MaintenancePreview {
  const local = { state: 'satisfied' as const, issues: [], providers: [{ fileId, id: 'some_mod', ownerId: 'some_mod', version: '1', via: ['private/nested.jar'] }] };
  const platform = { state: 'satisfied' as const, issues: [], files: [{ fileId, status: 'matched' as const, version: {
    projectId: 'abcdefgh', versionId: '12345678', name: 'private', versionNumber: '1', release: 'release' as const,
    publishedAt: '2026-11-11T00:00:00.000Z', loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_and_server', dependencies: [],
    files: [{ filename: 'some.jar', size: 5, sha1: 'c'.repeat(40), sha512: 'd'.repeat(128), url: 'https://secret.invalid/object', primary: true }],
    evidence: { url: 'https://secret.invalid/metadata', sha256: 'e'.repeat(64) },
  } }] };
  return { rootId: '00000000-0000-4000-8000-000000000001', instanceId: '00000000-0000-4000-8000-000000000002',
    instanceRevision: 1, fingerprint: 'f'.repeat(64), filename: 'some.jar', sha256: '1'.repeat(64), platformFailures: [],
    impact: { fileId, action: 'disable', state: 'ready', before: { local, platform },
      after: { local: structuredClone(local), platform: structuredClone(platform) },
      affectedProviders: local.providers, introducedIssues: [], resolvedIssues: [], directRequiredBy: [otherId], transitiveRequiredBy: [],
      relations: [{ scope: 'platform', dependentFileId: otherId, providerFileId: fileId, optional: false,
        selector: JSON.stringify({ projectId: 'abcdefgh', versionId: '12345678' }), via: [] }], truncated: false } };
}
test('presentation removes private URLs and archive entry paths, preserves identities and alias ownership', () => {
  const input = fixture(); const snapshot = structuredClone(input); const result = presentMaintenancePreview(input);
  assert.equal(result.state, 'ready'); assert.equal(result.providers[0]!.embeddedDepth, 1);
  assert.equal(result.relations[0]!.dependencyProjectId, 'abcdefgh'); assert.equal(result.relations[0]!.dependencyVersionId, '12345678');
  assert.ok(!JSON.stringify(result).includes('secret.invalid')); assert.ok(!JSON.stringify(result).includes('private/nested.jar'));
  result.providers[0]!.id = 'other_mod'; assert.deepEqual(input, snapshot);
});
test('unsupported evidence is discarded and cannot yield a ready result', () => {
  const input = fixture(); input.impact.affectedProviders[0]!.version = 'https://secret.invalid/version';
  input.impact.relations[0]!.selector = JSON.stringify({ projectId: 'https://secret.invalid', versionId: null });
  const result = presentMaintenancePreview(input);
  assert.equal(result.state, 'unknown'); assert.equal(result.incomplete, true); assert.equal(result.providers[0]!.version, null);
  assert.equal(result.relations.length, 0); assert.ok(!JSON.stringify(result).includes('secret.invalid'));
});
test('pre-existing and prospective issues remain distinguishable and preserve safe requirements', () => {
  const input = fixture(); input.impact.state = 'blocked';
  input.impact.before.local.issues.push({ severity: 'error', code: 'MOD_DEPENDENCY_MISSING', fileId, modId: 'some_mod',
    dependencyId: 'base_mod', expected: '>=2', actual: [], via: [] });
  input.impact.after.local.issues.push({ severity: 'unknown', code: 'UNKNOWN_VERSION', fileId, modId: 'some_mod',
    dependencyId: null, expected: null, actual: ['https://secret.invalid'], via: ['nested.jar'] });
  const result = presentMaintenancePreview(input);
  assert.equal(result.state, 'blocked'); assert.equal(result.incomplete, true);
  assert.equal(result.issues[0]!.moment, 'before'); assert.equal(result.issues[0]!.requirement, '>=2');
  assert.equal(result.issues[1]!.moment, 'after'); assert.deepEqual(result.issues[1]!.actual, []);
});
test('a shared 512-entry budget bounds the complete impact presentation', () => {
  const input = fixture(); input.impact.relations = Array.from({ length: 512 }, () => ({ scope: 'local' as const,
    dependentFileId: otherId, providerFileId: fileId, optional: false, selector: 'some_mod', via: [] }));
  const result = presentMaintenancePreview(input);
  assert.equal(result.state, 'unknown'); assert.equal(result.incomplete, true);
  assert.ok(result.providers.length + result.issues.length + result.relations.length + result.directRequiredBy.length
    + result.transitiveRequiredBy.length + result.platformFailures.length <= 512);
});
test('invalid file identifiers, digests and path-like filenames are rejected', () => {
  for (const mutation of ['filename', 'fingerprint', 'digest', 'instance'] as const) {
    const input = fixture();
    if (mutation === 'filename') input.filename = '../elsewhere.jar';
    if (mutation === 'fingerprint') input.fingerprint = 'not-a-digest';
    if (mutation === 'digest') input.sha256 = 'not-a-digest';
    if (mutation === 'instance') input.instanceId = '../elsewhere';
    assert.throws(() => presentMaintenancePreview(input), /INVALID_MAINTENANCE_PRESENTATION/);
  }
});
