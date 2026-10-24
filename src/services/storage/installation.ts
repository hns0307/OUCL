import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { normalizeDataDirectory } from '../../core/path/layout.js';
import { StorageError } from './files.js';

export interface Installation { rootId: string; dataDirectory: string }
/** Only this fixed domain record may cross the private worker bridge; no general JSON writer exists. */
export function parseInstallation(value: unknown): Installation {
  if (!exactObject(value, ['rootId', 'dataDirectory']) || typeof value.rootId !== 'string' || !UUID_PATTERN.test(value.rootId)
    || typeof value.dataDirectory !== 'string') throw new StorageError('INVALID_RECORD');
  try { return { rootId: value.rootId, dataDirectory: normalizeDataDirectory(value.dataDirectory) }; }
  catch { throw new StorageError('INVALID_RECORD'); }
}
