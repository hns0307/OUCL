import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { installRelativePath } from '../install/assets.js';

export type DistributionArea = 'mods' | 'resourcepacks' | 'config';
interface TargetFile { area: DistributionArea; path: string }
export type DistributionOperation = TargetFile & (
  | { kind: 'add'; artifactId: string; sha256: string; size: number }
  | { kind: 'replace'; artifactId: string; sha256: string; size: number; managedId: string; expectedSha256: string }
  | { kind: 'remove'; managedId: string; expectedSha256: string }
  | { kind: 'keep' });
export interface DistributionManifest {
  formatVersion: 1; packageId: string; packageVersion: string;
  target: { minecraft: string; javaMajor: 8 | 17 | 21; loader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'; loaderVersion: string | null };
  operations: DistributionOperation[];
}
export interface DistributionEnvelope {
  payload: DistributionManifest; signature: { algorithm: 'ed25519'; keyId: string; value: string };
}
/** Source implementations must authenticate exact canonical bytes before returning any proposal. No production source is enabled. */
export interface DistributionSource {
  resolve(request: { packageId: string; packageVersion: string }, signal?: AbortSignal): Promise<DistributionEnvelope>;
}
export class DistributionError extends Error {
  constructor(readonly code: 'INVALID_MANIFEST' | 'UNTRUSTED_DISTRIBUTION' | 'CANCELLED') { super(code); this.name = 'DistributionError'; }
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function invalid(): never { throw new DistributionError('INVALID_MANIFEST'); }
function location(area: unknown, relative: unknown): TargetFile {
  if (!['mods', 'resourcepacks', 'config'].includes(String(area)) || typeof relative !== 'string') invalid();
  try { installRelativePath(relative); } catch { invalid(); }
  return { area: area as DistributionArea, path: relative };
}
/** Parses fixed operations and preserves their explicit order. Paths name only files within three controlled areas. */
export function parseDistributionManifest(value: unknown): DistributionManifest {
  if (!exactObject(value, ['formatVersion', 'packageId', 'packageVersion', 'target', 'operations']) || value.formatVersion !== 1
    || !id(value.packageId) || !id(value.packageVersion) || !exactObject(value.target, ['minecraft', 'javaMajor', 'loader', 'loaderVersion'])
    || !id(value.target.minecraft) || ![8, 17, 21].includes(Number(value.target.javaMajor)) || typeof value.target.javaMajor !== 'number'
    || !['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(String(value.target.loader))
    || (value.target.loader === 'vanilla' ? value.target.loaderVersion !== null : !id(value.target.loaderVersion))
    || !Array.isArray(value.operations) || value.operations.length > 256) invalid();
  const paths: string[] = [];
  const operations = value.operations.map((rawEntry: unknown): DistributionOperation => {
    if (!rawEntry || typeof rawEntry !== 'object' || !('kind' in rawEntry)) invalid();
    const entry = rawEntry as Record<string, unknown>;
    const download = entry.kind === 'add' || entry.kind === 'replace'; const managed = entry.kind === 'replace' || entry.kind === 'remove';
    if (!['add', 'replace', 'remove', 'keep'].includes(String(entry.kind))
      || !exactObject(entry, ['kind', 'area', 'path', ...(download ? ['artifactId', 'sha256', 'size'] : []), ...(managed ? ['managedId', 'expectedSha256'] : [])])) invalid();
    const target = location(entry.area, entry.path); const key = `${target.area}/${target.path}`.toLowerCase();
    if (paths.some(other => other === key || other.startsWith(`${key}/`) || key.startsWith(`${other}/`))) invalid(); paths.push(key);
    if (managed && (typeof entry.managedId !== 'string' || !UUID_PATTERN.test(entry.managedId) || !hash(entry.expectedSha256))) invalid();
    if (download && (!id(entry.artifactId) || !hash(entry.sha256) || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size)
      || entry.size < 1 || entry.size > 1024 ** 3)) invalid();
    if (entry.kind === 'keep') return { kind: 'keep', ...target };
    const owned = managed ? { managedId: String(entry.managedId).toLowerCase(), expectedSha256: String(entry.expectedSha256) } : undefined;
    if (entry.kind === 'remove') return { kind: 'remove', ...target, ...owned! };
    const file = { artifactId: String(entry.artifactId), sha256: String(entry.sha256), size: Number(entry.size) };
    return entry.kind === 'add' ? { kind: 'add', ...target, ...file } : { kind: 'replace', ...target, ...file, ...owned! };
  });
  return { formatVersion: 1, packageId: value.packageId, packageVersion: value.packageVersion,
    target: { minecraft: value.target.minecraft, javaMajor: value.target.javaMajor as 8 | 17 | 21,
      loader: value.target.loader as DistributionManifest['target']['loader'], loaderVersion: value.target.loaderVersion as string | null }, operations };
}
/** Signature input uses fixed key order and validated values, independent of received object-key order. */
export function canonicalDistributionPayload(value: unknown): string { return JSON.stringify(parseDistributionManifest(value)); }

/** Signature metadata is not authentication: the source must still verify it with an explicitly configured trusted key. */
export function parseDistributionEnvelope(value: unknown): DistributionEnvelope {
  if (!exactObject(value, ['payload', 'signature']) || !exactObject(value.signature, ['algorithm', 'keyId', 'value'])
    || value.signature.algorithm !== 'ed25519' || !id(value.signature.keyId) || typeof value.signature.value !== 'string'
    || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature.value)) invalid();
  return { payload: parseDistributionManifest(value.payload), signature: { algorithm: 'ed25519', keyId: value.signature.keyId, value: value.signature.value } };
}

export interface DistributionObservation extends TargetFile { sha256: string; managedId: string | null }
export interface DistributionDiff { changes: DistributionOperation[]; conflicts: Array<{ area: DistributionArea; path: string; code: 'EXISTS' | 'UNMANAGED' | 'CHANGED' }> }
/** Pure preview only. Omitted local files are never operations; destructive operations require managed identity AND old hash. */
export function distributionDiff(value: DistributionManifest, observations: readonly DistributionObservation[]): DistributionDiff {
  const manifest = parseDistributionManifest(value); if (observations.length > 4096) invalid();
  const files = new Map<string, DistributionObservation>();
  for (const file of observations) {
    const target = location(file.area, file.path); const key = `${target.area}/${target.path}`.toLowerCase();
    if (files.has(key) || !hash(file.sha256) || file.managedId !== null && !UUID_PATTERN.test(file.managedId)) invalid(); files.set(key, file);
  }
  const changes: DistributionOperation[] = []; const conflicts: DistributionDiff['conflicts'] = [];
  for (const operation of manifest.operations) {
    if (operation.kind === 'keep') continue;
    const key = `${operation.area}/${operation.path}`.toLowerCase(); const current = files.get(key);
    const overlaps = [...files.keys()].some(other => other.startsWith(`${key}/`) || key.startsWith(`${other}/`));
    const code = operation.kind === 'add' ? current || overlaps ? 'EXISTS' : null
      : !current || !current.managedId || current.managedId.toLowerCase() !== operation.managedId ? 'UNMANAGED'
        : current.sha256 !== operation.expectedSha256 ? 'CHANGED' : null;
    if (code) conflicts.push({ area: operation.area, path: operation.path, code }); else changes.push(operation);
  }
  return { changes: conflicts.length ? [] : changes, conflicts };
}
