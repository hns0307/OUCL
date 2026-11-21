import { exactObject } from '../../shared/contracts/handshake.js';
import { StorageError } from './files.js';
import { isDownloadPreferences } from '../../shared/contracts/download-preferences.js';
import type { DownloadPreferences } from '../../shared/contracts/download-preferences.js';

export interface LaunchSettings { memoryMiB: number; isolationDefault: boolean; downloads?: DownloadPreferences }
export const DEFAULT_SETTINGS: LaunchSettings = { memoryMiB: 2048, isolationDefault: true };
/** Validates the fixed settings domain; machine capacity is checked separately by the service. */
export function parseSettings(value: unknown): LaunchSettings {
  if (!exactObject(value, ['memoryMiB', 'isolationDefault', ...(value && typeof value === 'object' && Object.hasOwn(value, 'downloads') ? ['downloads'] : [])]) || typeof value.memoryMiB !== 'number'
    || !Number.isSafeInteger(value.memoryMiB) || value.memoryMiB < 512 || value.memoryMiB > 65536
    || typeof value.isolationDefault !== 'boolean' || Object.hasOwn(value, 'downloads') && !isDownloadPreferences(value.downloads)) throw new StorageError('INVALID_RECORD');
  return { memoryMiB: value.memoryMiB, isolationDefault: value.isolationDefault,
    ...(isDownloadPreferences(value.downloads) ? { downloads: value.downloads } : {}) };
}
