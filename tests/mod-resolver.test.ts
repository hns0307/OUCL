import assert from 'node:assert/strict';
import test from 'node:test';
import { ModDependencyResolver } from '../src/services/mods/resolver.js';
import type { ModCandidateInput } from '../src/services/mods/candidates.js';
import type { PlatformDependency, PlatformModVersion } from '../src/core/mods/platform.js';

const id = (value: string): string => value.padEnd(8, 'z');
const required = (project: string, version?: string): PlatformDependency => ({ projectId: id(project), versionId: version ? id(version) : null, type: 'required', filename: null });
function version(project: string, name = `${project}1`, dependencies: PlatformDependency[] = []): PlatformModVersion {
  const projectId = id(project); const versionId = id(name);
  return { projectId, versionId, dependencies, name, versionNumber: 'not-the-jar-version', release: 'release', publishedAt: '2026-01-01T00:00:00Z',
    gameVersions: ['1.20.1'], loaders: ['fabric'], environment: 'client_and_server',
    files: [{ filename: `${name}.jar`, url: `https://cdn.modrinth.com/data/${projectId}/${versionId}/mod.jar`, size: 1, primary: true, sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) }],
    evidence: { url: `https://api.modrinth.com/v2/version/${versionId}`, sha256: 'c'.repeat(64) } };
}
const input = (): ModCandidateInput => ({ roots: [id('A1')], selections: {}, installed: [], minecraft: '1.20.1', loader: 'fabric', unknownInstalled: false });
function api(values: PlatformModVersion[]) {
  const calls: string[] = [];
  return { calls, version: async (versionId: string) => { calls.push(versionId); const found = values.find(item => item.versionId === versionId); assert.ok(found); return found; },
    candidates: async (project: string) => { calls.push(`project:${project}`); return values.filter(item => item.projectId === project); } };
}
test('resolver proposes stable releases then newest date and exact ID without interpreting platform version numbers', async () => {
  const stable = version('B', 'B2'); const beta = { ...version('B', 'B3'), release: 'beta' as const, publishedAt: '2026-10-01T00:00:00Z' };
  const older = { ...version('B'), publishedAt: '2025-01-01T00:00:00Z' }; const sameDate = version('B', 'B9');
  const result = await new ModDependencyResolver(api([version('A', 'A1', [required('B')]), beta, sameDate, older, stable])).resolve(input());
  assert.equal(result.graph.state, 'resolved'); assert.equal(result.selected.find(item => item.projectId === id('B'))?.versionId, id('B2'));
});
test('later incompatible pins backtrack to a satisfying older project candidate with cached exact evidence', async () => {
  const values = [version('A', 'A1', [required('B'), required('C', 'C1')]),
    { ...version('B', 'B2', [required('C', 'C2')]), publishedAt: '2026-02-01T00:00:00Z' }, version('B', 'B1', [required('C', 'C1')]), version('C'), version('C', 'C2')];
  const before = JSON.stringify(values); const client = api(values); const result = await new ModDependencyResolver(client).resolve(input());
  assert.equal(result.graph.state, 'resolved'); assert.equal(result.selected.find(item => item.projectId === id('B'))?.versionId, id('B1'));
  assert.equal(result.attempts, 3); assert.equal(client.calls.filter(call => call === `project:${id('B')}`).length, 1); assert.equal(JSON.stringify(values), before);
});
test('explicit root pins and installed versions remain fixed while optional dependencies stay unselected', async () => {
  const optional = { ...required('O'), type: 'optional' as const };
  const client = api([version('A', 'A1', [required('B'), optional]), version('B'), version('B', 'B2')]);
  const data = input(); data.installed = [version('B')];
  const reused = await new ModDependencyResolver(client).resolve(data);
  assert.equal(reused.graph.state, 'resolved'); assert.equal(reused.graph.nodes.find(item => item.projectId === id('B'))?.disposition, 'reuse');
  assert.ok(!client.calls.some(call => call.startsWith('project:'))); assert.equal(reused.selected.some(item => item.projectId === id('O')), false);
  const fixed = api([version('A', 'A1', [required('B', 'B2')]), version('B', 'B2')]);
  const conflict = await new ModDependencyResolver(fixed).resolve(data); assert.equal(conflict.graph.state, 'conflict');
  const pinned = await new ModDependencyResolver(fixed).resolve(input()); assert.equal(pinned.selected.find(item => item.projectId === id('B'))?.versionId, id('B2'));
});
test('explicit player choices are never silently replaced and empty choices cannot claim success', async () => {
  const client = api([version('A', 'A1', [required('B'), required('C', 'C1')]), version('B', 'B2', [required('C', 'C2')]), version('B'), version('C'), version('C', 'C2')]);
  const data = input(); data.selections = { [id('B')]: id('B2') };
  assert.equal((await new ModDependencyResolver(client).resolve(data)).graph.state, 'conflict');
  const empty = await new ModDependencyResolver(api([version('A', 'A1', [required('B')])])).resolve(input());
  assert.equal(empty.graph.state, 'unknown'); assert.ok(empty.graph.issues.some(item => item.code === 'MISSING_CANDIDATE'));
});
test('all conflicting alternatives are reported without treating a failed read as unsatisfiability', async () => {
  const conflict = { ...required('A'), type: 'incompatible' as const };
  const result = await new ModDependencyResolver(api([version('A', 'A1', [required('B')]), version('B', 'B1', [conflict]), version('B', 'B2', [conflict])])).resolve(input());
  assert.equal(result.graph.state, 'conflict'); assert.ok(result.graph.issues.some(item => item.code === 'NO_SOLUTION'));
  const client = api([version('A', 'A1', [required('B')])]);
  await assert.rejects(new ModDependencyResolver({ ...client, candidates: async () => { throw new Error('NETWORK_FAILURE'); } }).resolve(input()), /NETWORK_FAILURE/);
});
test('solver considers a viable candidate beyond the 32-entry display preview', async () => {
  const choices = Array.from({ length: 33 }, (_, index) => ({ ...version('B', `B${index}`, [required('C', index === 32 ? 'C1' : 'C2')]), publishedAt: new Date(Date.UTC(2026, 1, 34 - index)).toISOString() }));
  const result = await new ModDependencyResolver(api([version('A', 'A1', [required('B'), required('C', 'C1')]), ...choices, version('C'), version('C', 'C2')])).resolve(input());
  assert.equal(result.graph.state, 'resolved'); assert.equal(result.selected.find(item => item.projectId === id('B'))?.versionId, id('B32'));
});
test('search budget and unknown installed evidence stay explicit unknowns instead of false conflicts', async () => {
  const client = api([version('A', 'A1', [required('B')]), version('B')]);
  const bounded = await new ModDependencyResolver(client, 1).resolve(input()); assert.equal(bounded.graph.state, 'unknown');
  assert.ok(bounded.graph.issues.some(item => item.code === 'SEARCH_LIMIT'));
  const data = input(); data.unknownInstalled = true; const unknown = await new ModDependencyResolver(client).resolve(data);
  assert.equal(unknown.graph.state, 'unknown'); assert.ok(unknown.graph.issues.some(item => item.code === 'UNKNOWN_INSTALLED'));
});
test('cancellation joins an in-flight read, prevents expansion and bounds concurrent resolution', async () => {
  let release!: (item: PlatformModVersion) => void; let began!: () => void;
  const reading = new Promise<void>(resolve => { began = resolve; }); const gate = new Promise<PlatformModVersion>(resolve => { release = resolve; });
  let expanded = false; const service = new ModDependencyResolver({ version: async () => { began(); return gate; }, candidates: async () => { expanded = true; return []; } });
  const abort = new AbortController(); const pending = service.resolve(input(), abort.signal); await reading;
  await assert.rejects(service.resolve(input()), { code: 'PLATFORM_LIMIT' }); abort.abort();
  release(version('A', 'A1', [required('B')])); await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(expanded, false);
});
test('valid project identities cannot accidentally read inherited object properties', async () => {
  const client = api([version('A', 'A1', [required('toString')]), version('toString', 'Valid001')]);
  const result = await new ModDependencyResolver(client).resolve(input()); assert.equal(result.graph.state, 'resolved');
  assert.equal(result.selected.find(item => item.projectId === 'toString')?.versionId, 'Valid001');
});
test('cyclic candidates can be rejected in favor of an acyclic alternative', async () => {
  const newer = { ...version('B', 'B2', [required('A', 'A1')]), publishedAt: '2026-02-01T00:00:00Z' };
  const result = await new ModDependencyResolver(api([version('A', 'A1', [required('B')]), newer, version('B')])).resolve(input());
  assert.equal(result.graph.state, 'resolved'); assert.equal(result.selected.find(item => item.projectId === id('B'))?.versionId, id('B1'));
  const data = input(); data.unknownInstalled = true;
  assert.equal((await new ModDependencyResolver(api([version('A', 'A1', [required('B', 'B2')]), newer])).resolve(data)).graph.state, 'conflict');
});
test('cached version identities cannot be substituted by a project candidate response', async () => {
  const client = api([version('A', 'A1', [required('B')])]);
  await assert.rejects(new ModDependencyResolver({ ...client, candidates: async () => [version('B', 'A1')] }).resolve(input()), { code: 'UNTRUSTED_METADATA' });
});
