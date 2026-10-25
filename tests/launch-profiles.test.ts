import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseLaunchProfiles, offlineUuid, validGameName } from '../src/services/storage/launch-profiles.js';
import { ProfileService } from '../src/services/launch/profiles.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import type { JavaRuntime } from '../src/services/java/probe.js';
import { parseStorageRequest, parseReply } from '../src/services/workers/protocol.js';

const id = '00000000-0000-4000-8000-000000000001';
const java: JavaRuntime = { executable: 'D:\\Fixture Java\\bin\\java.exe', major: 17, version: '17.0.12', vendor: 'fixture', architecture: 'x64', os: 'windows' };
test('offline UUID v3 matches Java nameUUIDFromBytes compatibility vectors and preserves case', () => {
  assert.equal(offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  assert.equal(offlineUuid('Steve'), '5627dd98-e6be-3c21-b8a8-e92344183641');
  assert.notEqual(offlineUuid('Steve'), offlineUuid('steve'));
  for (const name of ['AB', 'a'.repeat(17), '中文名', 'bad name', 'Abc\n', '../x', '']) { assert.equal(validGameName(name), false); assert.throws(() => offlineUuid(name)); }
  assert.ok(validGameName('Ab_')); assert.ok(validGameName('Abcdefghijklmn_1'));
});
test('profile parser refuses unknown fields, invalid relationships and path/identity spoofing', () => {
  const account = { accountId: id, displayName: '中文昵称', gameName: 'Player_1', uuid: offlineUuid('Player_1') };
  const valid = { javas: [{ javaId: id, executable: java.executable, major: 17, version: java.version, vendor: java.vendor }], selectedJavaId: id, accounts: [account], requests: [] };
  assert.equal(parseLaunchProfiles(valid).accounts[0]?.displayName, '中文昵称');
  for (const value of [{ ...valid, token: 'forbidden' }, { ...valid, selectedJavaId: undefined }, { ...valid, selectedJavaId: randomUUID() },
    { ...valid, javas: [...valid.javas, ...valid.javas] }, { ...valid, accounts: [account, account] }, { ...valid, accounts: [{ ...account, uuid: randomUUID() }] },
    { ...valid, javas: [{ ...valid.javas[0], executable: 'relative/java.exe' }] }, { ...valid, javas: [{ ...valid.javas[0], executable: 'D:\\Fixture\\cmd.exe' }] },
    { ...valid, requests: [{ requestId: id, digest: 'a'.repeat(64), accountId: randomUUID() }] }, { ...valid, accounts: [{ ...account, displayName: 'bad\nname' }] }]) {
    assert.throws(() => parseLaunchProfiles(value));
  }
});
test('actual worker persists Java selection and independent offline identity across restart and unknown outcome retry', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-profiles-')); const entry = new URL('../src/services/workers/entry.js', import.meta.url);
  let storage: StorageClient | undefined;
  try {
    storage = await StorageClient.open(entry, directory); const probe = { probe: async () => java }; const service = new ProfileService(storage, probe);
    const request = randomUUID(); const [runtime, account] = await Promise.all([service.registerJava(java.executable), service.createOffline(request, { displayName: '社团成员', gameName: 'OUCL_Test1' })]);
    assert.equal((await service.list()).selectedJavaId, runtime.javaId); assert.equal((await service.list()).accounts.length, 1);
    assert.deepEqual(await service.createOffline(request.toUpperCase(), { displayName: '社团成员', gameName: 'OUCL_Test1' }), account);
    await assert.rejects(service.createOffline(request, { displayName: '修改请求', gameName: 'OUCL_Test1' }), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(service.createOffline(randomUUID(), { displayName: '其他昵称', gameName: 'OUCL_Test1' }), { code: 'ACCOUNT_CONFLICT' });
    await assert.rejects(service.createOffline(randomUUID(), { displayName: '昵称', gameName: 'ab' }), { code: 'ACCOUNT_NAME_INVALID' });
    assert.equal((await service.registerJava(java.executable)).javaId, runtime.javaId);
    await storage.close(); storage = await StorageClient.open(entry, directory); const reopened = new ProfileService(storage, probe);
    assert.deepEqual((await reopened.list()).accounts, [account]); assert.equal((await reopened.list()).selectedJavaId, runtime.javaId);
    assert.deepEqual(await reopened.createOffline(request, { displayName: '社团成员', gameName: 'OUCL_Test1' }), account);
    const renamed = await reopened.createOffline(randomUUID(), { displayName: '社团成员', gameName: 'OUCL_Test2' });
    assert.notEqual(renamed.accountId, account.accountId); assert.notEqual(renamed.uuid, account.uuid); assert.equal((await reopened.list()).accounts.length, 2);
    const stored = await storage.readLaunchProfiles(); assert.ok(stored);
    await assert.rejects(storage.writeLaunchProfiles(0, stored.data), { code: 'REVISION_CONFLICT' });
    const brokenProbe = new ProfileService(storage, { probe: async () => { throw new Error('private path'); } });
    await assert.rejects(brokenProbe.registerJava(java.executable), { code: 'JAVA_INVALID' });
  } finally {
    await storage?.close(); assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('oucl-profiles-'));
    await rm(directory, { recursive: true, force: true });
  }
});
test('private worker profile messages remain exact and cannot become arbitrary record IO', () => {
  const request = { version: 1, id, command: { kind: 'profiles:set', expectedRevision: 0, data: { javas: [], accounts: [], requests: [] } } };
  assert.deepEqual(parseStorageRequest(request), request);
  assert.throws(() => parseStorageRequest({ ...request, command: { ...request.command, path: 'D:\\arbitrary.json' } }));
  assert.throws(() => parseStorageRequest({ ...request, command: { kind: 'profiles:get', sql: 'SELECT *' } }));
  assert.throws(() => parseReply({ version: 1, kind: 'response', id, ok: true, profiles: { schemaVersion: 2, revision: 1, data: {} } }));
  assert.throws(() => parseReply({ version: 1, kind: 'response', id, ok: true, profiles: { schemaVersion: 1, revision: 1, data: { javas: [], accounts: [], requests: [] } }, object: { digest: 'a'.repeat(64), size: 0 } }));
});
