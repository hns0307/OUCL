import test from 'node:test';
import assert from 'node:assert/strict';
import { updateSettings } from '../src/services/launch/settings.js';
import { isProfilePayload } from '../src/shared/contracts/profiles.js';
import { parseSettings } from '../src/services/storage/settings.js';
import type { LaunchSettings } from '../src/services/storage/settings.js';
import type { RecordEnvelope } from '../src/services/storage/records.js';
import { WorkerError } from '../src/services/workers/protocol.js';

test('settings reject unknown fields, non-integers and capacity overflow before writing', async () => {
  for (const patch of [{}, { path: 'private' }, { memoryMiB: 511 }, { memoryMiB: 1024.5 }, { isolationDefault: 'yes' }]) {
    assert.equal(isProfilePayload({ expectedRevision: 0, patch }, 'settings:update'), false);
  }
  assert.throws(() => parseSettings({ memoryMiB: 2048, isolationDefault: true, extra: 1 }));
  let writes = 0;
  await assert.rejects(updateSettings({ readSettings: async () => undefined, writeSettings: async () => { writes++; throw new Error(); } }, 0, { memoryMiB: 8192 }, 4096), { code: 'MEMORY_OUT_OF_RANGE' });
  assert.equal(writes, 0);
});
test('settings CAS persists values, merges defaults, rejects stale revisions and maps concurrent conflicts', async () => {
  let saved: RecordEnvelope<LaunchSettings> | undefined;
  const storage = { readSettings: async () => saved, writeSettings: async (revision: number, data: LaunchSettings) => {
    saved = { schemaVersion: 1 as const, revision: revision + 1, data }; return saved;
  } };
  assert.deepEqual((await updateSettings(storage, 0, { memoryMiB: 3072 }, 4096)).data, { memoryMiB: 3072, isolationDefault: true });
  assert.deepEqual((await updateSettings(storage, 1, { isolationDefault: false }, 4096)).data, { memoryMiB: 3072, isolationDefault: false });
  await assert.rejects(updateSettings(storage, 1, { memoryMiB: 2048 }, 4096), { code: 'REVISION_CONFLICT' });
  await assert.rejects(updateSettings({ ...storage, writeSettings: async () => { throw new WorkerError('REVISION_CONFLICT'); } }, 2, { memoryMiB: 2048 }, 4096), { code: 'REVISION_CONFLICT' });
});
