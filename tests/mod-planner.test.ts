import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlatformModVersion } from '../src/core/mods/platform.js';
import type { ModInspection } from '../src/services/mods/inspection.js';
import type { ModLibraryRoot } from '../src/services/mods/library.js';
import { ModInstallPlanner } from '../src/services/mods/planner.js';
import type { ModResolution } from '../src/services/mods/resolver.js';
import type { ResourceRecord } from '../src/services/storage/resources.js';

const sha1 = (value: string): string => value.repeat(40);
const sha512 = (value: string): string => value.repeat(128);
function version(projectId: string, versionId: string, marker: string, dependencies: PlatformModVersion['dependencies'] = []): PlatformModVersion {
  return { projectId, versionId, name: `${projectId} name`, versionNumber: 'display-only', release: 'release', publishedAt: '2026-01-01T00:00:00Z',
    loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_and_server', dependencies,
    files: [{ filename: `${projectId}.jar`, url: `https://cdn.modrinth.com/data/${projectId}/${versionId}/${projectId}.jar`, size: marker.charCodeAt(0),
      primary: true, sha1: sha1(marker), sha512: sha512(marker) }], evidence: { url: `https://api.modrinth.com/v2/version/${versionId}`, sha256: 'e'.repeat(64) } };
}
const rootVersion = version('RootProj', 'RootVer1', 'a');
const rootRecord: ResourceRecord = { taskId: '00000000-0000-4000-8000-000000000222', projectId: 'RootProj', versionId: 'RootVer1', fileId: sha1('a'),
  filename: 'RootProj.jar', kind: 'mod', title: 'Root', versionName: 'Root version', size: 'a'.charCodeAt(0), downloaded: true,
  spec: { url: 'https://cdn.modrinth.com/data/RootProj/RootVer1/RootProj.jar', expected: { algorithm: 'sha1', digest: sha1('a'),
    size: 'a'.charCodeAt(0), provenanceId: `modrinth:RootProj:RootVer1:${sha1('a')}` }, anchor: { kind: 'modrinth-version', algorithm: 'sha256', digest: 'e'.repeat(64) } },
  object: { digest: 'd'.repeat(64), size: 'a'.charCodeAt(0), sourceKey: 'c'.repeat(64) } };
const rootLibrary = (): ModLibraryRoot => ({
  record: rootRecord,
  version: rootVersion,
  scan: { size: 'a'.charCodeAt(0), sha1: sha1('a'), sha256: 'd'.repeat(64), sha512: sha512('a'), archives: [{ entries: [], sha256: 'd'.repeat(64), documents: [],
    declarations: [{ format: 'fabric', mods: [], nested: [], language: null, issues: [] }] }] }
});
function inspection(items: ModInspection['inventory']['items'] = [], files: ModInspection['platform']['files'] = []): ModInspection {
  return { inventory: { instanceId: '00000000-0000-4000-8000-000000000111', revision: 7, fingerprint: 'f'.repeat(64), items,
    local: { state: 'satisfied', issues: [], providers: [] } }, platform: { state: 'satisfied', files, issues: [] }, platformFailures: [] };
}
const context = async () => ({ instanceId: '00000000-0000-4000-8000-000000000111', revision: 7, modsDirectory: 'not-exposed',
  environment: { loader: 'fabric' as const, versions: { minecraft: '1.20.1' }, languageVersions: {} } });
const input = { instanceId: '00000000-0000-4000-8000-000000000111', expectedRevision: 7,
  root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: sha1('a') }, selections: {} };

test('planner binds a downloaded root, resolved dependency bytes and the current instance fingerprint without paths or URLs', async () => {
  const dependency = version('Depends1', 'DepVers1', 'b');
  const resolution: ModResolution = { selected: [rootVersion, dependency], options: [], attempts: 2, graph: { state: 'resolved', issues: [], nodes: [
    { projectId: 'Depends1', versionId: 'DepVers1', disposition: 'candidate', requiredBy: ['RootProj'], filename: 'Depends1.jar', sha512: sha512('b') },
    { projectId: 'RootProj', versionId: 'RootVer1', disposition: 'candidate', requiredBy: [], filename: 'RootProj.jar', sha512: sha512('a') }
  ] } };
  const planner = new ModInstallPlanner({ read: async () => rootLibrary() }, { check: async () => inspection() }, context,
    { resolve: async value => { assert.equal(value.unknownInstalled, false); return resolution; } });
  const plan = await planner.plan(input);
  assert.equal(plan.state, 'ready'); assert.equal(plan.items[0]?.disposition, 'download'); assert.equal(plan.items[1]?.disposition, 'library');
  assert.equal(plan.totalDownloadBytes, 'b'.charCodeAt(0)); assert.match(plan.planId, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(plan).includes('cdn.modrinth.com'), false); assert.equal(JSON.stringify(plan).includes('not-exposed'), false);
  assert.deepEqual(await planner.plan(input), plan);
});

test('unknown installed identities remain a non-confirmable plan with their dependency evidence', async () => {
  const item = { fileId: 'x'.repeat(64), filename: 'unknown.jar', enabled: true, size: 1, sha1: null, sha256: null, sha512: null, archives: [], issues: [] };
  const issue = { severity: 'unknown' as const, code: 'UNKNOWN_INSTALLED' as const, projectId: null, versionId: null, requiredBy: [] };
  const resolution: ModResolution = { selected: [rootVersion], options: [], attempts: 1,
    graph: { state: 'unknown', issues: [issue], nodes: [{ projectId: 'RootProj', versionId: 'RootVer1', disposition: 'candidate', requiredBy: [], filename: 'RootProj.jar', sha512: sha512('a') }] } };
  const planner = new ModInstallPlanner({ read: async () => rootLibrary() }, { check: async () => inspection([item], [{ fileId: item.fileId, status: 'unknown', version: null }]) }, context,
    { resolve: async value => { assert.equal(value.unknownInstalled, true); return resolution; } });
  const plan = await planner.plan(input); assert.equal(plan.state, 'unknown'); assert.deepEqual(plan.issues, [issue]);
});

test('platform substitution or downloaded-root hash mismatch cannot produce a plan', async () => {
  const substituted = { ...rootVersion, name: 'changed facts' };
  const resolution: ModResolution = { selected: [substituted], options: [], attempts: 1,
    graph: { state: 'resolved', issues: [], nodes: [{ projectId: 'RootProj', versionId: 'RootVer1', disposition: 'candidate', requiredBy: [], filename: 'RootProj.jar', sha512: sha512('a') }] } };
  const planner = new ModInstallPlanner({ read: async () => rootLibrary() }, { check: async () => inspection() }, context, { resolve: async () => resolution });
  await assert.rejects(planner.plan(input), { code: 'UNTRUSTED_METADATA' });
  const bad = rootLibrary(); bad.scan.sha1 = sha1('c');
  const exact = { ...resolution, selected: [rootVersion] };
  await assert.rejects(new ModInstallPlanner({ read: async () => bad }, { check: async () => inspection() }, context,
    { resolve: async () => exact }).plan(input), { code: 'UNTRUSTED_METADATA' });
  const unsafe = inspection(); unsafe.inventory.local.state = 'unsatisfied'; unsafe.inventory.local.issues.push({ severity: 'error', code: 'DUPLICATE_MOD_ID',
    fileId: 'local', modId: 'duplicate', dependencyId: null, expected: null, actual: ['1', '2'], via: [] });
  await assert.rejects(new ModInstallPlanner({ read: async () => rootLibrary() }, { check: async () => unsafe }, context,
    { resolve: async () => exact }).plan(input), { code: 'MODS_UNSAFE' });
});

test('planner accepts unchanged version facts when independent response evidence changes', async () => {
  const reread = { ...rootVersion, evidence: { ...rootVersion.evidence, sha256: 'f'.repeat(64) } };
  const resolution: ModResolution = { selected: [reread], options: [], attempts: 1,
    graph: { state: 'resolved', issues: [], nodes: [{ projectId: 'RootProj', versionId: 'RootVer1', disposition: 'candidate', requiredBy: [], filename: 'RootProj.jar', sha512: sha512('a') }] } };
  const planner = new ModInstallPlanner({ read: async () => rootLibrary() }, { check: async () => inspection() }, context, { resolve: async () => resolution });
  assert.equal((await planner.plan(input)).state, 'ready');
});

test('planner cancellation joins an in-flight library read and rejects concurrent previews', async () => {
  let began!: () => void; let release!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; }); const abort = new AbortController();
  const planner = new ModInstallPlanner({ read: async () => { began(); await gate; return rootLibrary(); } }, { check: async () => inspection() }, context,
    { resolve: async () => { throw new Error('not reached'); } });
  const pending = planner.plan(input, abort.signal); await started; await assert.rejects(planner.plan(input), { code: 'SCAN_BUSY' });
  abort.abort(); release(); await assert.rejects(pending, { code: 'CANCELLED' });
});
