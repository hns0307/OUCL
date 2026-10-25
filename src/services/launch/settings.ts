import { totalmem } from 'node:os';
import { DEFAULT_SETTINGS, parseSettings } from '../storage/settings.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { LaunchSettings } from '../storage/settings.js';
import { ProfileContractError } from '../../shared/contracts/profiles.js';
import { WorkerError } from '../workers/protocol.js';

/** Validates capacity before CAS commit; no running process or existing game directory is changed. */
export async function updateSettings(storage: Pick<StorageClient, 'readSettings' | 'writeSettings'>, expectedRevision: number,
  patch: Partial<LaunchSettings>, capacityMiB = Math.floor(totalmem() / 1024 ** 2)): Promise<{ revision: number; data: LaunchSettings }> {
  const current = await storage.readSettings();
  if ((current?.revision ?? 0) !== expectedRevision) throw new ProfileContractError('REVISION_CONFLICT');
  const data = parseSettings({ ...(current?.data ?? DEFAULT_SETTINGS), ...patch });
  if (data.memoryMiB > Math.min(65536, capacityMiB)) throw new ProfileContractError('MEMORY_OUT_OF_RANGE');
  try { return await storage.writeSettings(expectedRevision, data); }
  catch (error) { if (error instanceof WorkerError && error.code === 'REVISION_CONFLICT') throw new ProfileContractError('REVISION_CONFLICT'); throw error; }
}
