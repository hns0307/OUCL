import { exactObject } from '../../shared/contracts/handshake.js';
import { parseManifest } from '../../core/version/manifest.js';
import { createHash } from 'node:crypto';
import { StorageError } from './files.js';

export interface CatalogCache { fetchedAt: string; body: string; sha256: string }
/** Fixed cache schema, protected by the existing authoritative JSON operation history. */
export function parseCatalogCache(value: unknown): CatalogCache {
  try {
    if (!exactObject(value, ['fetchedAt', 'body', 'sha256']) || typeof value.fetchedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.fetchedAt) || !Number.isFinite(Date.parse(value.fetchedAt))
      || typeof value.body !== 'string' || Buffer.byteLength(value.body) > 2 * 1024 * 1024 || typeof value.sha256 !== 'string'
      || createHash('sha256').update(value.body).digest('hex') !== value.sha256) throw new StorageError('INVALID_RECORD');
    parseManifest(JSON.parse(value.body) as unknown);
    return { fetchedAt: value.fetchedAt, body: value.body, sha256: value.sha256 };
  } catch { throw new StorageError('INVALID_RECORD'); }
}
