import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_DOWNLOAD_PREFERENCES, isDownloadPreferences } from '../src/shared/contracts/download-preferences.js';
import { isProfilePayload, isProfileData } from '../src/shared/contracts/profiles.js';
import { parseSettings } from '../src/services/storage/settings.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { configureDownloads, updateSettings } from '../src/services/launch/settings.js';
import { ProfileService } from '../src/services/launch/profiles.js';
import { profileDispatcher } from '../src/ipc/profiles-adapter.js';
const defaults = DEFAULT_DOWNLOAD_PREFERENCES;
test('download settings reject arbitrary sources, unsafe concurrency and unknown versions', () => {
  assert.ok(isDownloadPreferences(defaults));
  for (const bad of [{ ...defaults, source: 'https://untrusted.invalid' }, { ...defaults, source: 'auto' }, { ...defaults, formatVersion: 2 },
    { ...defaults, path: 'private' }, ...[0, 9, NaN, 1.5].flatMap(number => [{ ...defaults, fileConcurrency: number }, { ...defaults, connectionsPerFile: number }])]) {
    assert.equal(isDownloadPreferences(bad), false);
    assert.equal(isProfilePayload({ expectedRevision: 0, preferences: bad }, 'settings:downloadsUpdate'), false);
    assert.throws(() => parseSettings({ memoryMiB: 2048, isolationDefault: true, downloads: bad }));
  }
  assert.ok(isProfilePayload({}, 'settings:downloadsGet'));
  assert.equal(isProfilePayload({ url: 'private' }, 'settings:downloadsGet'), false);
  assert.ok(isProfileData({ ...defaults, revision: 0 }, 'settings:downloadsGet'));
  assert.equal(isProfileData({ ...defaults, revision: 0, path: 'private' }, 'settings:downloadsGet'), false);
  assert.deepEqual(parseSettings({ memoryMiB: 2048, isolationDefault: false }), { memoryMiB: 2048, isolationDefault: false });
});
test('real settings worker preserves old fields, CAS conflicts and download preferences across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-download-settings-'));
  const entry = new URL('../src/services/workers/entry.js', import.meta.url); let storage = await StorageClient.open(entry, directory);
  const preferences = { ...defaults, source: 'bmclapi' as const, fileConcurrency: 8, connectionsPerFile: 2 };
  try {
    const old = await updateSettings(storage, 0, { memoryMiB: 1024, isolationDefault: false });
    const saved = await configureDownloads(storage, old.revision, preferences);
    assert.equal(saved.data.memoryMiB, 1024); assert.equal(saved.data.isolationDefault, false);
    await assert.rejects(configureDownloads(storage, old.revision, defaults), { code: 'REVISION_CONFLICT' });
    await updateSettings(storage, saved.revision, { memoryMiB: 2048 });
    assert.deepEqual((await storage.readSettings())!.data.downloads, preferences);
    await storage.close(); storage = await StorageClient.open(entry, directory);
    const dispatcher = profileDispatcher(new ProfileService(storage), storage, async () => undefined);
    const id = '00000000-0000-4000-8000-000000000001';
    assert.deepEqual(await dispatcher('settings:downloadsGet', {}, id), { ...preferences, revision: 3 });
    const legacy = await dispatcher('settings:get', {}, id);
    assert.ok(isProfileData(legacy, 'settings:get')); assert.equal('downloads' in legacy, false); assert.equal(legacy.memoryMiB, 2048);
  } finally { await storage.close(); }
});
