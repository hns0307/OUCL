import { exactObject } from '../../shared/contracts/handshake.js';
import { parseDistributionManifest } from './manifest.js';
import type { DistributionManifest } from './manifest.js';

export const MAX_RELEASE_VALIDITY_MS = 31 * 24 * 60 * 60 * 1000;
export interface DistributionReleasePayload {
  releaseFormatVersion: 2; sourceId: string; packageId: string; packageVersion: string;
  sequence: number; issuedAt: number; expiresAt: number; manifestSha256: string; manifest: DistributionManifest;
}
export interface DistributionReleaseEnvelope {
  payload: DistributionReleasePayload; signature: { algorithm: 'ed25519'; keyId: string; value: string };
}
export type ReleaseCode = 'INVALID_RELEASE' | 'UNTRUSTED_RELEASE' | 'RELEASE_EXPIRED' | 'RELEASE_NOT_YET_VALID'
  | 'RELEASE_DOWNGRADE' | 'RELEASE_EQUIVOCATION' | 'RELEASE_STATE_CONFLICT' | 'RELEASE_STATE_INVALID' | 'RELEASE_TIMEOUT' | 'CANCELLED';
/** Fixed, redacted release failures; no URLs, keys, payloads or filesystem errors are exposed. */
export class ReleaseError extends Error {
  constructor(readonly code: ReleaseCode) { super(code); this.name = 'ReleaseError'; }
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
function invalid(): never { throw new ReleaseError('INVALID_RELEASE'); }

/** Version 2 is a separate signed protocol; the embedded version-1 manifest keeps its original canonical bytes. */
export function parseDistributionReleasePayload(value: unknown): DistributionReleasePayload {
  if (!exactObject(value, ['releaseFormatVersion', 'sourceId', 'packageId', 'packageVersion', 'sequence', 'issuedAt', 'expiresAt', 'manifestSha256', 'manifest'])
    || value.releaseFormatVersion !== 2 || !id(value.sourceId) || !id(value.packageId) || !id(value.packageVersion)
    || typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !timestamp(value.issuedAt) || !timestamp(value.expiresAt) || value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > MAX_RELEASE_VALIDITY_MS
    || typeof value.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.manifestSha256)) invalid();
  let manifest: DistributionManifest; try { manifest = parseDistributionManifest(value.manifest); } catch { return invalid(); }
  if (manifest.packageId !== value.packageId || manifest.packageVersion !== value.packageVersion) invalid();
  return { releaseFormatVersion: 2, sourceId: value.sourceId, packageId: value.packageId, packageVersion: value.packageVersion,
    sequence: value.sequence, issuedAt: value.issuedAt, expiresAt: value.expiresAt, manifestSha256: value.manifestSha256, manifest };
}

/** Signature input has an exact field order and excludes only the outer signature metadata. */
export function canonicalDistributionReleasePayload(value: unknown): string { return JSON.stringify(parseDistributionReleasePayload(value)); }

/** Structural parsing is not signature verification or acceptance by an authoritative sequence store. */
export function parseDistributionReleaseEnvelope(value: unknown): DistributionReleaseEnvelope {
  if (!exactObject(value, ['payload', 'signature']) || !exactObject(value.signature, ['algorithm', 'keyId', 'value'])
    || value.signature.algorithm !== 'ed25519' || !id(value.signature.keyId) || typeof value.signature.value !== 'string'
    || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature.value)) invalid();
  return { payload: parseDistributionReleasePayload(value.payload), signature: { algorithm: 'ed25519', keyId: value.signature.keyId, value: value.signature.value } };
}

/** Time validity uses the caller's trusted clock. Expiry is exclusive; no implicit clock-skew extension. */
export function checkDistributionReleaseTime(payload: DistributionReleasePayload, now: number): void {
  if (!timestamp(now)) throw new ReleaseError('RELEASE_STATE_INVALID');
  if (payload.issuedAt > now) throw new ReleaseError('RELEASE_NOT_YET_VALID');
  if (payload.expiresAt <= now) throw new ReleaseError('RELEASE_EXPIRED');
}
