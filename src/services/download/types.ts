import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { definition, sourceKey } from '../objects/provenance.js';
import type { TrustAnchor } from '../objects/provenance.js';
import type { ExpectedArtifact } from '../../core/download/integrity.js';

export type DownloadCode = 'INVALID_TRANSFER' | 'NETWORK_FAILED' | 'BAD_RESPONSE' | 'TIMEOUT' | 'CANCELLED'
  | 'DISK_FULL' | 'DISK_PERMISSION' | 'TRANSFER_IO' | 'RETRY_LATER' | 'TRANSFER_BUSY' | 'HASH_MISMATCH' | 'NEEDS_RECOVERY';
/** A bounded transfer failure without URLs, local paths, response bodies or operating-system stacks. */
export class DownloadError extends Error {
  readonly category: 'validation' | 'network' | 'cancelled' | 'disk' | 'biz';
  constructor(readonly code: DownloadCode, readonly retryAfterMs?: number) {
    super(code); this.name = 'DownloadError';
    this.category = code === 'INVALID_TRANSFER' ? 'validation' : code === 'CANCELLED' ? 'cancelled'
      : code === 'TRANSFER_BUSY' ? 'biz' : ['DISK_FULL', 'DISK_PERMISSION', 'TRANSFER_IO', 'NEEDS_RECOVERY'].includes(code) ? 'disk' : 'network';
  }
}
export interface DownloadSpec { url: string; expected: ExpectedArtifact; anchor: TrustAnchor }
export interface TransferRecord extends DownloadSpec {
  key: string;
  stagingId: string;
  revision: number;
  bytesDone: number;
  state: 'partial' | 'complete' | 'committed';
  etag?: string;
  lastModified?: string;
  objectDigest?: string;
}
export type TransferCheckpoint = (expectedRevision: number, next: TransferRecord) => Promise<void>;
export interface TransferOptions { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }

/** Restricts first-party Minecraft artifact transport; redirects, query credentials and arbitrary hosts are excluded. */
export function isArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && ['piston-data.mojang.com', 'resources.download.minecraft.net', 'libraries.minecraft.net', 'launcher.mojang.com', 'cdn.modrinth.com',
        'maven.fabricmc.net', 'maven.quiltmc.org', 'maven.minecraftforge.net', 'maven.neoforged.net'].includes(url.hostname);
  } catch { return false; }
}
/** Parses exact private durable metadata; validators never substitute for the expected content hash. */
export function parseTransferRecord(value: unknown): TransferRecord {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new DownloadError('INVALID_TRANSFER');
    const row = value as Record<string, unknown>;
    const optional = ['etag', 'lastModified', 'objectDigest'].filter(key => Object.hasOwn(row, key));
    if (!exactObject(row, ['url', 'expected', 'anchor', 'key', 'stagingId', 'revision', 'bytesDone', 'state', ...optional])
      || typeof row.url !== 'string' || !isArtifactUrl(row.url) || typeof row.key !== 'string' || !/^[a-f0-9]{64}$/.test(row.key)
      || typeof row.stagingId !== 'string' || !UUID_PATTERN.test(row.stagingId)
      || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER
      || typeof row.bytesDone !== 'number' || !Number.isSafeInteger(row.bytesDone) || row.bytesDone < 0
      || typeof row.state !== 'string' || !['partial', 'complete', 'committed'].includes(row.state)) throw new DownloadError('INVALID_TRANSFER');
    const facts = definition(row.expected, row.anchor);
    if (sourceKey(facts.expected, facts.anchor) !== row.key || row.bytesDone > facts.expected.size
      || row.state !== 'partial' && row.bytesDone !== facts.expected.size
      || row.etag !== undefined && (typeof row.etag !== 'string' || !/^"[\x21\x23-\x7e]{0,180}"$/.test(row.etag))
      || row.lastModified !== undefined && (typeof row.lastModified !== 'string' || row.lastModified.length > 80
        || !Number.isFinite(Date.parse(row.lastModified)) || new Date(row.lastModified).toUTCString() !== row.lastModified)
      || row.objectDigest !== undefined && (typeof row.objectDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.objectDigest))
      || (row.state === 'committed') !== (row.objectDigest !== undefined)) throw new DownloadError('INVALID_TRANSFER');
    return { ...facts, url: row.url, key: row.key, stagingId: row.stagingId, revision: row.revision, bytesDone: row.bytesDone,
      state: row.state as TransferRecord['state'], ...(row.etag === undefined ? {} : { etag: row.etag as string }),
      ...(row.lastModified === undefined ? {} : { lastModified: row.lastModified as string }),
      ...(row.objectDigest === undefined ? {} : { objectDigest: row.objectDigest as string }) };
  } catch { throw new DownloadError('INVALID_TRANSFER'); }
}
