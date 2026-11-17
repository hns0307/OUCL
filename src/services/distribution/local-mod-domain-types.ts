import type { ModInventoryContext, ModInventoryItem, ModInventoryService } from '../mods/inventory.js';
import type { ModArchiveReader } from '../workers/mod-archive-reader.js';
import type { PlatformModVersion } from '../../core/mods/platform.js';
import type { DirectoryProof, DistributionPlan, JournalRepository } from './transaction-record.js';

export type LocalModDomainCode = 'INVALID_DOMAIN_INPUT' | 'UNSUPPORTED_OPERATION' | 'DOMAIN_BUSY' | 'DOMAIN_CAPACITY'
  | 'DOMAIN_EXPIRED' | 'DOMAIN_CLOSED' | 'FILES_CHANGED' | 'ARTIFACT_UNVERIFIED' | 'PERMISSION_DENIED'
  | 'PERMISSION_UNKNOWN' | 'MODS_INCOMPATIBLE' | 'MODS_UNDETERMINED' | 'JOURNAL_UNAVAILABLE' | 'CANCELLED';
/** Internal redacted failures; no public capability or permission is granted by these types. */
export class LocalModDomainError extends Error {
  constructor(readonly code: LocalModDomainCode) { super(code); this.name = 'LocalModDomainError'; }
}
export interface ArtifactBinding {
  planDigest: string; operationIndex: number; artifactId: string; sha256: string; size: number;
}
/** A decision supplied by a reviewed main-owned policy, never by a renderer or signed package alone. */
export interface LocalArtifactEvidence {
  binding: ArtifactBinding; path: string; permission: 'verified' | 'denied' | 'unknown';
}
export interface LocalModDomainContext {
  rootId: string; gameIdentity: DirectoryProof; context: ModInventoryContext;
}
export interface LocalModDomainPorts {
  resolveLocalArtifact(plan: DistributionPlan, index: number, signal?: AbortSignal): Promise<LocalArtifactEvidence>;
  readContext(plan: DistributionPlan, signal?: AbortSignal): Promise<LocalModDomainContext>;
  inventory: Pick<ModInventoryService, 'scan'>;
  scanner: Pick<ModArchiveReader, 'read'>;
  readJournal: JournalRepository['read'];
  versionsByHash(items: readonly ModInventoryItem[], signal?: AbortSignal): Promise<ReadonlyMap<string, PlatformModVersion>>;
}
export interface LocalModDomainOptions {
  now?: () => number;
  maxSessions?: number;
  maxSeen?: number;
  ttlMs?: number;
}
