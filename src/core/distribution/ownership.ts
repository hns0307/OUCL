import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { installRelativePath } from '../install/assets.js';
import { DistributionError } from './manifest.js';
import type { DistributionArea, DistributionObservation } from './manifest.js';

export interface PackageReceiptEntry {
  sourceId: string; packageId: string; packageVersion: string; managedId: string;
  area: DistributionArea; path: string; sha256: string;
}
export interface PackageReceipt { formatVersion: 1; instanceId: string; entries: PackageReceiptEntry[] }
export interface UserAddedEvidence { area: DistributionArea; path: string; sha256: string }
export interface OwnershipRow extends DistributionObservation {
  ownership: 'package-managed' | 'user-added' | 'local-discovered' | 'user-overridden' | 'ownership-conflict';
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const key = (entry: { area: DistributionArea; path: string }): string => `${entry.area}/${entry.path}`.toLowerCase();
function invalid(): never { throw new DistributionError('INVALID_MANIFEST'); }

/** Independent read-only receipt format; parsing never creates ownership for an old instance. */
export function parsePackageReceipt(value: unknown, instanceId: string): PackageReceipt {
  if (!exactObject(value, ['formatVersion', 'instanceId', 'entries']) || value.formatVersion !== 1
    || typeof value.instanceId !== 'string' || !UUID_PATTERN.test(value.instanceId) || value.instanceId.toLowerCase() !== instanceId.toLowerCase()
    || !Array.isArray(value.entries) || value.entries.length > 4096) invalid();
  const identities = new Set<string>();
  const entries = value.entries.map((raw: unknown): PackageReceiptEntry => {
    if (!exactObject(raw, ['sourceId', 'packageId', 'packageVersion', 'managedId', 'area', 'path', 'sha256'])
      || !id(raw.sourceId) || !id(raw.packageId) || !id(raw.packageVersion) || typeof raw.managedId !== 'string' || !UUID_PATTERN.test(raw.managedId)
      || !['mods', 'resourcepacks', 'config'].includes(String(raw.area)) || typeof raw.path !== 'string' || !hash(raw.sha256)) invalid();
    try { installRelativePath(raw.path); } catch { invalid(); }
    const identity = `${raw.sourceId}/${raw.packageId}/${raw.managedId.toLowerCase()}`;
    if (identities.has(identity)) invalid(); identities.add(identity);
    return { sourceId: raw.sourceId, packageId: raw.packageId, packageVersion: raw.packageVersion, managedId: raw.managedId.toLowerCase(),
      area: raw.area as DistributionArea, path: raw.path, sha256: raw.sha256 };
  });
  return { formatVersion: 1, instanceId: value.instanceId.toLowerCase(), entries };
}

/** Only an exact receipt/content match establishes package ownership; hashes alone never adopt a file. */
export function projectDistributionOwnership(files: readonly DistributionObservation[], receipt: PackageReceipt | undefined,
  owner: { sourceId: string; packageId: string }, userAdded: readonly UserAddedEvidence[] = []): OwnershipRow[] {
  if (files.length > 4096 || userAdded.length > 4096) invalid();
  return files.map(file => {
    const claims = receipt?.entries.filter(entry => key(entry) === key(file)) ?? [];
    if (claims.length > 1) return { ...file, managedId: null, ownership: 'ownership-conflict' };
    const claim = claims[0];
    if (claim && (claim.sourceId !== owner.sourceId || claim.packageId !== owner.packageId)) return { ...file, managedId: null, ownership: 'ownership-conflict' };
    if (claim) return { ...file, managedId: claim.managedId, ownership: claim.sha256 === file.sha256 ? 'package-managed' : 'user-overridden' };
    return { ...file, managedId: null, ownership: userAdded.some(entry => key(entry) === key(file) && entry.sha256 === file.sha256) ? 'user-added' : 'local-discovered' };
  });
}
