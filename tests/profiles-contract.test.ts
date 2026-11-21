import test from 'node:test';
import assert from 'node:assert/strict';
import { isProfileData, isProfilePayload, isProfileResult, profileFailure } from '../src/shared/contracts/profiles.js';
import type { ProfileChannel, ProfileDispatcher } from '../src/shared/contracts/profiles.js';
import { handleProfiles } from '../src/ipc/profiles.js';
import { profileDispatcher } from '../src/ipc/profiles-adapter.js';
import { ProfileService } from '../src/services/launch/profiles.js';
import type { RecordEnvelope } from '../src/services/storage/records.js';
import type { LaunchProfiles } from '../src/services/storage/launch-profiles.js';
import { CAPABILITIES, isHandshakeResult } from '../src/shared/contracts/handshake.js';

const id = '00000000-0000-4000-8000-000000000001';
test('profile schemas reject paths, unknown channels/fields, unsafe names and invalid settings', () => {
  for (const channel of ['java:choose', 'accounts:list', 'settings:get'] as const) { assert.ok(isProfilePayload({}, channel)); assert.equal(isProfilePayload({ path: 'private' }, channel), false); }
  assert.equal(isProfilePayload({}, 'arbitrary' as ProfileChannel), false);
  assert.ok(isProfilePayload({ displayName: '中文昵称', gameName: 'OUCL_Test1' }, 'accounts:createOffline'));
  for (const gameName of ['ab', 'bad name', '中文姓名', 'a'.repeat(17)]) assert.equal(isProfilePayload({ displayName: '昵称', gameName }, 'accounts:createOffline'), false);
  const publicAccount = { accountId: id, kind: 'offline', displayName: '昵称', gameName: 'Player_1', ready: true };
  assert.ok(isProfileData({ account: publicAccount }, 'accounts:createOffline'));
  assert.equal(isProfileData({ account: { ...publicAccount, uuid: id } }, 'accounts:createOffline'), false);
  assert.equal(isProfileData({ items: [publicAccount, publicAccount] }, 'accounts:list'), false);
  const java = { javaId: id, major: 17, arch: 'x64', source: 'system', available: true };
  assert.ok(isProfileData({ selection: 'chosen', java }, 'java:choose'));
  assert.equal(isProfileData({ selection: 'chosen', java: { ...java, executable: 'private' } }, 'java:choose'), false);
  assert.equal(isProfileData({ selection: 'chosen', java: { ...java, arch: 'x86' } }, 'java:choose'), false);
  assert.equal(isProfileData({ revision: 0, memoryMiB: 2, isolationDefault: true, theme: 'system' }, 'settings:get'), false);
});
test('trusted handler rejects invalid envelope/sender before side effects and validates returned DTO', async () => {
  let calls = 0; const dispatch: ProfileDispatcher = async () => { calls++; throw new Error('private path token'); };
  const input = { contractVersion: 1, requestId: id, payload: {} };
  for (const [value, trusted, expected] of [[input, false, 'INVALID_SENDER'], [{ ...input, payload: { executable: 'x' } }, true, 'INVALID_ARGUMENT'], [{ ...input, contractVersion: 2 }, true, 'UNSUPPORTED_CONTRACT']] as const) {
    const result = await handleProfiles('java:choose', value, trusted, id, dispatch); assert.ok(!result.ok); assert.equal(result.error.code, expected);
  }
  assert.equal(calls, 0);
  const failure = await handleProfiles('java:choose', input, true, id, dispatch); assert.ok(!failure.ok); assert.equal(failure.error.code, 'UNAVAILABLE'); assert.ok(!JSON.stringify(failure).includes('private'));
  const leak = (async () => ({ selection: 'chosen', path: 'private' })) as unknown as ProfileDispatcher;
  assert.equal((await handleProfiles('java:choose', input, true, id, leak)).ok, false);
});
test('adapter exposes public profiles/settings and only registers a chosen measured Java', async () => {
  let stored: RecordEnvelope<LaunchProfiles> | undefined; let selected = false; let probes = 0;
  const storage = { readLaunchProfiles: async () => stored, writeLaunchProfiles: async (revision: number, data: LaunchProfiles) => {
    assert.equal(revision, stored?.revision ?? 0); stored = { schemaVersion: 1, revision: revision + 1, data }; return stored;
  }, readInstallation: async () => undefined, readSettings: async () => undefined,
  writeSettings: async (revision: number, data: import('../src/services/storage/settings.js').LaunchSettings) => ({ schemaVersion: 1 as const, revision: revision + 1, data }) };
  const profiles = new ProfileService(storage, { probe: async () => { probes++; return { executable: 'D:\\Fixture\\java.exe', major: 17, version: '17.0.12', vendor: 'fixture', architecture: 'x64', os: 'windows' }; } });
  const dispatch = profileDispatcher(profiles, storage, async () => selected ? 'D:\\Fixture\\java.exe' : undefined);
  assert.deepEqual(await dispatch('java:choose', {}, id), { selection: 'cancelled' }); assert.equal(probes, 0);
  selected = true; const java = await dispatch('java:choose', {}, id); assert.equal(java.selection, 'chosen'); assert.equal(probes, 1);
  const created = await dispatch('accounts:createOffline', { displayName: '成员', gameName: 'OUCL_Test1' }, id);
  assert.deepEqual(await dispatch('accounts:list', {}, id), { items: [created.account] });
  assert.equal('uuid' in created.account, false); assert.equal('executable' in java, false);
  assert.ok((await dispatch('settings:get', {}, id)).javaId);
});
test('profile error mapping/correlation and full implemented capability list remain exact', () => {
  for (const code of ['ACCOUNT_NAME_INVALID', 'ACCOUNT_CONFLICT', 'JAVA_INVALID', 'STORAGE_UNAVAILABLE', 'TIMEOUT'] as const) {
    const result = profileFailure<'java:choose'>(id, code, id); assert.ok(isProfileResult(result, id, 'java:choose'));
    assert.equal(isProfileResult(result, '00000000-0000-4000-8000-000000000002', 'java:choose'), false);
  }
  assert.ok(isHandshakeResult({ contractVersion: 1, requestId: id, ok: true, data: { selectedVersion: 1, sessionId: id, capabilities: [...CAPABILITIES] } }, id));
});
