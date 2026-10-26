import { exactObject } from './handshake.js';

export interface DownloadPreferences {
  formatVersion: 1; source: 'official' | 'bmclapi'; fileConcurrency: number; connectionsPerFile: number;
}
export const DEFAULT_DOWNLOAD_PREFERENCES: Readonly<DownloadPreferences> = Object.freeze({ formatVersion: 1, source: 'official', fileConcurrency: 4, connectionsPerFile: 4 });
export function isDownloadPreferences(value: unknown): value is DownloadPreferences {
  return exactObject(value, ['formatVersion', 'source', 'fileConcurrency', 'connectionsPerFile']) && value.formatVersion === 1
    && (value.source === 'official' || value.source === 'bmclapi')
    && typeof value.fileConcurrency === 'number' && Number.isSafeInteger(value.fileConcurrency) && value.fileConcurrency >= 1 && value.fileConcurrency <= 8
    && typeof value.connectionsPerFile === 'number' && Number.isSafeInteger(value.connectionsPerFile) && value.connectionsPerFile >= 1 && value.connectionsPerFile <= 8;
}
