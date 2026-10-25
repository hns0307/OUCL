import { createHash } from 'node:crypto';
import type { ExpectedArtifact } from '../../core/download/integrity.js';

export interface TrustAnchor { kind: 'mojang-version' | 'mojang-assets' | 'mojang-runtime' | 'adoptium-runtime' | 'modrinth-version'; algorithm: 'sha1' | 'sha256'; digest: string }
export interface Provenance { schemaVersion: 1; objectDigest: string; expected: ExpectedArtifact; anchor: TrustAnchor }
export type ObjectCode = 'INVALID_ARTIFACT' | 'HASH_MISMATCH' | 'NEEDS_RECOVERY' | 'STORE_BUSY' | 'OBJECT_IO';
/** A fixed object-store failure that never carries a local path or upstream metadata. */
export class ObjectError extends Error {
  readonly category: 'validation' | 'network' | 'disk' | 'biz';
  constructor(readonly code: ObjectCode) {
    super(code); this.name = 'ObjectError';
    this.category = code === 'INVALID_ARTIFACT' ? 'validation' : code === 'HASH_MISMATCH' ? 'network' : code === 'STORE_BUSY' ? 'biz' : 'disk';
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, names: string[]): boolean { return Object.keys(value).sort().join(',') === names.sort().join(','); }
const hex = (value: unknown, size: number): value is string => typeof value === 'string' && value.length === size && /^[a-fA-F0-9]+$/.test(value);

/** Canonicalizes service-anchored facts. These validators cannot authenticate an upstream response. */
export function definition(expected: unknown, anchor: unknown): { expected: ExpectedArtifact; anchor: TrustAnchor } {
  if (!record(expected) || !keys(expected, ['algorithm', 'digest', 'size', 'provenanceId'])
    || typeof expected.algorithm !== 'string' || !['sha1', 'sha256'].includes(expected.algorithm) || !hex(expected.digest, expected.algorithm === 'sha1' ? 40 : 64)
    || typeof expected.size !== 'number' || !Number.isSafeInteger(expected.size) || expected.size < 0 || expected.size > 64 * 1024 ** 3
    || typeof expected.provenanceId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(expected.provenanceId)
    || !record(anchor) || !keys(anchor, ['kind', 'algorithm', 'digest'])
    || typeof anchor.kind !== 'string' || !['mojang-version', 'mojang-assets', 'mojang-runtime', 'adoptium-runtime', 'modrinth-version'].includes(anchor.kind)
    || typeof anchor.algorithm !== 'string' || !['sha1', 'sha256'].includes(anchor.algorithm) || !hex(anchor.digest, anchor.algorithm === 'sha1' ? 40 : 64)) throw new ObjectError('INVALID_ARTIFACT');
  return { expected: { algorithm: expected.algorithm as ExpectedArtifact['algorithm'], digest: expected.digest.toLowerCase(), size: expected.size, provenanceId: expected.provenanceId },
    anchor: { kind: anchor.kind as TrustAnchor['kind'], algorithm: anchor.algorithm as TrustAnchor['algorithm'], digest: anchor.digest.toLowerCase() } };
}
/** Includes provenance identity in the search key; equal bytes do not merge source trust. */
export function sourceKey(expected: ExpectedArtifact, anchor: TrustAnchor): string {
  return createHash('sha256').update(JSON.stringify(definition(expected, anchor))).digest('hex');
}
/** Parses exact authoritative sidecar format; malformed evidence is never reconstructed from SHA256 alone. */
export function parseProvenance(bytes: Buffer): Provenance {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!record(value) || !keys(value, ['schemaVersion', 'objectDigest', 'expected', 'anchor']) || value.schemaVersion !== 1 || !hex(value.objectDigest, 64)) throw new ObjectError('NEEDS_RECOVERY');
    return { schemaVersion: 1, objectDigest: value.objectDigest.toLowerCase(), ...definition(value.expected, value.anchor) };
  } catch { throw new ObjectError('NEEDS_RECOVERY'); }
}
