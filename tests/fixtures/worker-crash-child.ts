import assert from 'node:assert/strict';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { OwnerGuard } from '../../src/services/storage/owner-guard.js';

const root = process.argv[2]!;
const client = await StorageClient.open(new URL('./worker.js', import.meta.url), root);
await assert.rejects(client.get('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'),
  error => error instanceof Error && error.message === 'WORKER_FAILED');
await client.close();
if (process.platform === 'win32') await assert.rejects(OwnerGuard.acquire(root), { code: 'STORE_BUSY' });
