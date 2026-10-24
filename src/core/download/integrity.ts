/** Facts anchored by the service to trusted upstream metadata, never mirror headers. */
export interface ExpectedArtifact {
  algorithm: 'sha1' | 'sha256';
  digest: string;
  size: number;
  provenanceId: string;
}

export interface ObservedArtifact { size: number; sha1: string; sha256: string }
export type IntegrityResult = { ok: true; objectDigest: string; provenanceId: string }
  | { ok: false; code: 'INVALID_INTEGRITY_FACTS' | 'SIZE_MISMATCH' | 'HASH_MISMATCH' };

/** Compares full streamed digests. This pure check cannot authenticate the supplied provenance. */
export function verifyArtifact(expected: ExpectedArtifact, observed: ObservedArtifact): IntegrityResult {
  const hex = (value: string, length: number): boolean => value.length === length && /^[a-fA-F0-9]+$/.test(value);
  if (!['sha1', 'sha256'].includes(expected.algorithm)
    || !Number.isSafeInteger(expected.size) || expected.size < 0
    || !Number.isSafeInteger(observed.size) || observed.size < 0
    || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(expected.provenanceId)
    || !hex(expected.digest, expected.algorithm === 'sha1' ? 40 : 64)
    || !hex(observed.sha1, 40) || !hex(observed.sha256, 64)) {
    return { ok: false, code: 'INVALID_INTEGRITY_FACTS' };
  }
  if (expected.size !== observed.size) return { ok: false, code: 'SIZE_MISMATCH' };
  if (expected.digest.toLowerCase() !== observed[expected.algorithm].toLowerCase()) return { ok: false, code: 'HASH_MISMATCH' };
  return { ok: true, objectDigest: observed.sha256.toLowerCase(), provenanceId: expected.provenanceId };
}
