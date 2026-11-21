import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPlatformMods } from '../src/core/mods/platform.js';
import type { PlatformLocalMod, PlatformModVersion } from '../src/core/mods/platform.js';
import type { ModEnvironment } from '../src/core/mods/check.js';
const environment: ModEnvironment = { loader: 'fabric', versions: { minecraft: '1.20.1' }, languageVersions: {} };
const local = (id = 'one', hash = 'a'.repeat(128)): PlatformLocalMod => ({ fileId: id, enabled: true, sha1: 'b'.repeat(40), sha512: hash,
  size: 100, formats: ['fabric'], unresolvedEmbedded: false });
function version(projectId = 'project1', versionId = 'version1', hash = 'a'.repeat(128)): PlatformModVersion {
  return { projectId, versionId, name: 'Display name', versionNumber: 'platform-label-is-not-a-mod-version', release: 'release',
    publishedAt: '2026-10-20T00:00:00Z', loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_or_server', dependencies: [],
    files: [{ sha1: 'b'.repeat(40), sha512: hash, size: 100, filename: 'example.jar', url: `https://cdn.modrinth.com/data/${projectId}/versions/${versionId}/example.jar`, primary: true }],
    evidence: { url: `https://api.modrinth.com/v2/version/${versionId}`, sha256: 'c'.repeat(64) } };
}
test('double check associates actual bytes and preserves platform/local version identities independently', () => {
  const item = local(); const metadata = version(); const report = checkPlatformMods('satisfied', [item], environment, new Map([[item.sha512!, metadata]]));
  assert.equal(report.state, 'satisfied'); assert.equal(report.files[0]!.status, 'matched'); assert.deepEqual(report.issues, []);
  assert.equal(report.files[0]!.version!.versionNumber, 'platform-label-is-not-a-mod-version');
  assert.equal(checkPlatformMods('unknown', [item], environment, new Map([[item.sha512!, metadata]])).state, 'unknown');
  assert.equal(checkPlatformMods('unsatisfied', [item], environment, new Map([[item.sha512!, metadata]])).state, 'unsatisfied');
  assert.equal(checkPlatformMods('satisfied', [item], environment, new Map()).state, 'unknown');
  assert.equal(checkPlatformMods('satisfied', [{ ...item, sha512: null }], environment, new Map()).state, 'unknown');
  assert.equal(checkPlatformMods('satisfied', [{ ...item, enabled: false }], environment, new Map()).state, 'satisfied');
});
test('wrong file proof, Minecraft, loader and client declarations surface evidence conflicts', () => {
  const item = local();
  for (const metadata of [
    { ...version(), files: [] }, { ...version(), files: [{ ...version().files[0]!, size: 101 }] },
    { ...version(), files: [{ ...version().files[0]!, sha1: 'd'.repeat(40) }] }, { ...version(), gameVersions: ['1.21'] },
    { ...version(), loaders: ['forge'] }, { ...version(), environment: 'dedicated_server_only' }
  ]) {
    const report = checkPlatformMods('satisfied', [item], environment, new Map([[item.sha512!, metadata]]));
    assert.equal(report.state, 'unsatisfied'); assert.equal(report.files[0]!.status, 'conflict');
  }
  assert.equal(checkPlatformMods('satisfied', [{ ...item, formats: ['forge'] }], environment, new Map([[item.sha512!, version()]])).state, 'unsatisfied');
  assert.equal(checkPlatformMods('satisfied', [item], { ...environment, loader: 'vanilla' }, new Map([[item.sha512!, version()]])).state, 'unsatisfied');
  assert.equal(checkPlatformMods('satisfied', [item], { ...environment, versions: {} }, new Map([[item.sha512!, version()]])).state, 'unknown');
  assert.equal(checkPlatformMods('satisfied', [item], environment, new Map([[item.sha512!, { ...version(), environment: 'unknown' }]])).state, 'unknown');
  assert.equal(checkPlatformMods('satisfied', [item], { ...environment, loader: 'quilt' }, new Map([[item.sha512!, version()]])).state, 'unknown');
});
test('fixed version prerequisites never degrade to any installed version of the same project', () => {
  const one = local(); const two = local('two', 'd'.repeat(128)); const parent = version();
  parent.dependencies = [{ projectId: 'project2', versionId: 'version2', filename: null, type: 'required' }];
  const wrong = version('project2', 'version3', two.sha512!);
  const hashes = new Map([[one.sha512!, parent], [two.sha512!, wrong]]);
  const mismatch = checkPlatformMods('satisfied', [one, two], environment, hashes);
  assert.equal(mismatch.state, 'unsatisfied'); assert.equal(mismatch.issues[0]!.code, 'PLATFORM_PIN_MISMATCH');
  assert.equal(mismatch.issues[0]!.dependencyVersionId, 'version2');
  hashes.set(two.sha512!, version('project2', 'version2', two.sha512!));
  assert.equal(checkPlatformMods('satisfied', [one, two], environment, hashes).state, 'satisfied');
  const missing = checkPlatformMods('satisfied', [one, { ...two, enabled: false }], environment, hashes);
  assert.equal(missing.issues[0]!.code, 'PLATFORM_DEPENDENCY_MISSING'); assert.equal(missing.state, 'unsatisfied');
  assert.equal(checkPlatformMods('satisfied', [one, { ...two, sha512: null }], environment, hashes).state, 'unknown');
});
test('optional, incompatible, embedded and identity-less platform relationships remain distinct', () => {
  const one = local(); const two = local('two', 'd'.repeat(128)); const parent = version();
  const hashes = new Map([[one.sha512!, parent], [two.sha512!, version('project2', 'version2', two.sha512!)]]);
  parent.dependencies = [{ projectId: 'project2', versionId: null, filename: null, type: 'optional' }];
  assert.equal(checkPlatformMods('satisfied', [one], environment, hashes).state, 'satisfied');
  parent.dependencies[0]!.type = 'incompatible';
  assert.equal(checkPlatformMods('satisfied', [one, two], environment, hashes).issues[0]!.code, 'PLATFORM_PROJECT_CONFLICT');
  parent.dependencies[0]!.type = 'embedded';
  assert.equal(checkPlatformMods('satisfied', [one, two], environment, hashes).state, 'unknown');
  parent.dependencies = [{ projectId: null, versionId: null, filename: 'mysterious.jar', type: 'required' }];
  assert.equal(checkPlatformMods('satisfied', [one], environment, hashes).issues[0]!.code, 'PLATFORM_DEPENDENCY_ID_UNKNOWN');
  parent.dependencies = [{ projectId: null, versionId: 'version2', filename: null, type: 'required' }];
  assert.equal(checkPlatformMods('satisfied', [one, two], environment, hashes).state, 'satisfied');
});
test('duplicate project versions and unresolved nested content block automatic resolution', () => {
  const one = local(); const two = local('two', 'd'.repeat(128));
  const hashes = new Map([[one.sha512!, version()], [two.sha512!, version('project1', 'version2', two.sha512!)]]);
  assert.equal(checkPlatformMods('satisfied', [one, two], environment, hashes).issues[0]!.code, 'DUPLICATE_PROJECT');
  const parent = version(); parent.dependencies = [{ projectId: 'project2', versionId: null, filename: null, type: 'required' }];
  hashes.set(one.sha512!, parent);
  const report = checkPlatformMods('satisfied', [{ ...one, unresolvedEmbedded: true }], environment, hashes);
  assert.equal(report.state, 'unknown'); assert.equal(report.issues[0]!.dependencyProjectId, 'project2');
  assert.equal(checkPlatformMods('satisfied', Array.from({ length: 257 }, (_, i) => ({ ...one, fileId: String(i), enabled: false })), environment, hashes).state, 'unknown');
});
