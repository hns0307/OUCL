import { verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { canonicalDistributionPayload, DistributionError, parseDistributionEnvelope } from '../../src/core/distribution/manifest.js';
import type { DistributionEnvelope, DistributionSource } from '../../src/core/distribution/manifest.js';

/** In-memory test adapter only. Keys and envelopes are injected; this is never assembled by the product. */
export function distributionTestSource(envelope: DistributionEnvelope, keys: ReadonlyMap<string, KeyObject>): DistributionSource {
  const snapshot = parseDistributionEnvelope(envelope);
  return { resolve: async (request, signal) => {
    if (signal?.aborted) throw new DistributionError('CANCELLED');
    const payload = snapshot.payload; const key = keys.get(snapshot.signature.keyId);
    if (!key || snapshot.signature.algorithm !== 'ed25519' || !/^[A-Za-z0-9+/]{86}==$/.test(snapshot.signature.value)
      || request.packageId !== payload.packageId || request.packageVersion !== payload.packageVersion
      || !verify(null, Buffer.from(canonicalDistributionPayload(payload)), key, Buffer.from(snapshot.signature.value, 'base64'))) throw new DistributionError('UNTRUSTED_DISTRIBUTION');
    return { payload, signature: structuredClone(snapshot.signature) };
  } };
}
