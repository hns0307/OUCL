import { exactObject } from '../../shared/contracts/handshake.js';
import { StorageError } from './files.js';

export interface LaunchSettings { memoryMiB: number; isolationDefault: boolean }
export const DEFAULT_SETTINGS: LaunchSettings = { memoryMiB: 2048, isolationDefault: true };
/** Validates the fixed settings domain; machine capacity is checked separately by the service. */
export function parseSettings(value: unknown): LaunchSettings {
  if (!exactObject(value, ['memoryMiB', 'isolationDefault']) || typeof value.memoryMiB !== 'number'
    || !Number.isSafeInteger(value.memoryMiB) || value.memoryMiB < 512 || value.memoryMiB > 65536
    || typeof value.isolationDefault !== 'boolean') throw new StorageError('INVALID_RECORD');
  return { memoryMiB: value.memoryMiB, isolationDefault: value.isolationDefault };
}
