import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childPath, isolationPolicy, LayoutError, normalizeDataDirectory, objectPath, planClasspath, planGameLayout, planInstanceRemoval, planIsolationChange, validateComponent } from '../src/core/path/layout.js';
import type { LayoutInput } from '../src/core/path/layout.js';

const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
const input: LayoutInput = { dataDirectory: 'd:/中文 游戏/', rootId, instanceId, mcVersionId: '1.21.1',
  directoryId: 'instance-a', versionRecordId: 'instance-a', isolation: { globalDefault: true, instance: 'inherit', pack: false },
  jar: { directoryId: 'hidden-base', versionRecordId: 'base-1.21.1' } };

test('local data paths preserve spaces/Chinese and reject ambiguous or remote roots', () => {
  assert.equal(normalizeDataDirectory('d:/中文 游戏/'), 'D:\\中文 游戏');
  assert.equal(normalizeDataDirectory('C:\\'), 'C:\\');
  assert.equal(childPath('C:\\', 'a/b'), 'C:\\a\\b');
  assert.equal(childPath('C:\\data', 'a\\b'), 'C:\\data\\a\\b');
  for (const invalid of ['relative', 'C:relative', '\\\\server\\share', '/unix', 'D:/../other', 'D:/a/./b', 'D:/CON/', 'D:/a.']) {
    assert.throws(() => normalizeDataDirectory(invalid), LayoutError);
  }
  for (const invalid of ['../x', '/x', '\\x', 'C:/x', 'a//b', 'a/..', 'a:b']) assert.throws(() => childPath('D:\\data', invalid), LayoutError);
  for (const invalid of ['', '.', '..', 'nul.jar', 'COM1', 'LPT9.txt', 'aux', 'trailing ', 'a?', 'a*', 'a|b', 'a<b', 'a;b', String.fromCharCode(0), 'a'.repeat(256)]) assert.throws(() => validateComponent(invalid), LayoutError);
  assert.throws(() => normalizeDataDirectory('D:/' + 'x/'.repeat(16400)), LayoutError);
  assert.throws(() => childPath('D:/' + 'x/'.repeat(16370), 'x'.repeat(80)), LayoutError);
});

test('isolation priority is pack, explicit override, then global default', () => {
  assert.deepEqual(isolationPolicy(input.isolation), { isolated: true, forced: false });
  assert.equal(isolationPolicy({ globalDefault: false, instance: 'inherit', pack: false }).isolated, false);
  assert.equal(isolationPolicy({ globalDefault: false, instance: 'on', pack: false }).isolated, true);
  assert.equal(isolationPolicy({ globalDefault: true, instance: 'off', pack: false }).isolated, false);
  assert.deepEqual(isolationPolicy({ globalDefault: false, instance: 'off', pack: true }), { isolated: true, forced: true });
  assert.deepEqual(planIsolationChange(input.isolation, 'off'), { isolated: false, willMigrate: false, existingDataRemains: true });
  assert.deepEqual(planIsolationChange({ ...input.isolation, pack: true }, 'on'), { isolated: true, willMigrate: false, existingDataRemains: true });
  assert.throws(() => planIsolationChange({ ...input.isolation, pack: true }, 'off'), LayoutError);
});

test('instance/version/upstream identities are independent and jar references are not copied', () => {
  const layout = planGameLayout(input);
  assert.equal(layout.instanceId, instanceId); assert.equal(layout.mcVersionId, '1.21.1');
  assert.ok(layout.gameDirectory.endsWith('versions\\instance-a'));
  assert.ok(layout.jar.endsWith('versions\\hidden-base\\base-1.21.1.jar'));
  assert.notEqual(layout.jar, layout.localJar);
  assert.equal(layout.assetsDirectory, layout.gameRoot + '\\assets');
  assert.equal(layout.librariesDirectory, layout.gameRoot + '\\libraries');
  assert.equal(layout.nativesDirectory, layout.versionDirectory + '\\natives');
  assert.ok(layout.instanceJson.endsWith('oucl.instance.json'));
  const sameVersion = planGameLayout({ ...input, directoryId: 'instance-b', versionRecordId: 'instance-b' });
  assert.equal(sameVersion.mcVersionId, layout.mcVersionId); assert.notEqual(sameVersion.gameDirectory, layout.gameDirectory);
  assert.notEqual(sameVersion.nativesDirectory, layout.nativesDirectory);
  const nonisolated = planGameLayout({ ...input, isolation: { ...input.isolation, instance: 'off' } });
  assert.equal(nonisolated.gameDirectory, nonisolated.gameRoot);
  assert.notEqual(nonisolated.nativesDirectory, nonisolated.gameRoot + '\\natives');
  assert.equal(nonisolated.assetsDirectory, layout.assetsDirectory);
});

test('paths reject invalid opaque ids and assigned directory escapes', () => {
  for (const changed of [{ rootId: '../root' }, { instanceId: 'player nickname' }, { mcVersionId: '../version' },
    { directoryId: '../instance' }, { directoryId: 'CON' }, { versionRecordId: 'C:escape' },
    { jar: { directoryId: 'bad/path', versionRecordId: 'record' } }]) assert.throws(() => planGameLayout({ ...input, ...changed }), LayoutError);
});

test('absolute classpath uses root libraries plus nearest ancestor jar, not gameDir', () => {
  const layout = planGameLayout(input);
  const classpath = planClasspath(layout, ['org/example/lib/1/lib-1.jar']);
  assert.equal(classpath, layout.librariesDirectory + '\\org\\example\\lib\\1\\lib-1.jar;' + layout.jar);
  assert.equal(planClasspath(layout, []), layout.jar);
  assert.throws(() => planClasspath(layout, ['../other.jar']), LayoutError);
});

test('content object paths use local SHA256 without upgrading source trust', () => {
  const value = objectPath(input.dataDirectory, 'A'.repeat(64));
  assert.ok(value.endsWith('store\\objects\\sha256\\aa\\' + 'a'.repeat(64)));
  for (const id of ['', 'a'.repeat(40), 'g'.repeat(64), '../a']) assert.throws(() => objectPath(input.dataDirectory, id), LayoutError);
});

test('removal keeps shared targets, parent dependencies and nonisolated root player data protected', () => {
  const layout = planGameLayout({ ...input, isolation: { ...input.isolation, instance: 'off' } });
  const plan = planInstanceRemoval(layout, true);
  assert.equal(plan.followLinks, false); assert.equal(plan.requiresDependencyCheck, true);
  assert.deepEqual(plan.versionRecordTargets, []);
  assert.ok(plan.protectedTargets.includes(layout.localJar));
  assert.ok(plan.protectedTargets.includes(layout.versionJson));
  assert.ok(plan.protectedTargets.includes(layout.gameRoot + '\\saves'));
  assert.ok(plan.protectedTargets.includes(layout.storeDirectory));
  assert.ok(plan.protectedTargets.includes(layout.jar));
  assert.ok(plan.privateTargets.every(target => target.startsWith(layout.versionDirectory + '\\')));
  assert.ok(!plan.privateTargets.includes(layout.jar));
  const unreferenced = planInstanceRemoval(layout, false);
  assert.deepEqual(unreferenced.versionRecordTargets, [layout.versionJson, layout.localJar]);
  assert.equal(planGameLayout({ ...input, jar: { directoryId: 'instance-a', versionRecordId: 'instance-a' } }).jar, layout.localJar);
});
