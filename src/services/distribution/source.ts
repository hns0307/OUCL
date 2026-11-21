import { createPublicKey, verify } from 'node:crypto';
import { canonicalDistributionPayload, DistributionError, parseDistributionEnvelope } from '../../core/distribution/manifest.js';
import type { DistributionEnvelope, DistributionSource } from '../../core/distribution/manifest.js';

export interface TrustedDistributionSource {
  sourceId: string; manifestOrigin: string; manifestPathPrefix: string;
  keys: readonly { keyId: string; spki: string; revoked: boolean }[];
}
/** No real publisher or public key has been supplied; product trust is intentionally empty. */
export const EMPTY_DISTRIBUTION_SOURCES: readonly TrustedDistributionSource[] = Object.freeze([]);
export const MAX_DISTRIBUTION_ENVELOPE_BYTES = 1024 * 1024;
const id = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
function untrusted(): never { throw new DistributionError('UNTRUSTED_DISTRIBUTION'); }
function interruptible<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => { reject(new Error('DISTRIBUTION_ABORTED')); };
    if (signal.aborted) { reject(new Error('DISTRIBUTION_ABORTED')); return; }
    signal.addEventListener('abort', stop, { once: true });
    void operation.then(value => { signal.removeEventListener('abort', stop); resolve(value); }, error => { signal.removeEventListener('abort', stop); reject(error); });
  });
}

/** HTTPS source with pinned Ed25519 SPKI keys, exact request binding, no redirects and bounded streaming. */
export class PinnedDistributionSource implements DistributionSource {
  private readonly record: TrustedDistributionSource;
  constructor(record: TrustedDistributionSource, private readonly fetcher: typeof fetch = fetch) {
    this.record = structuredClone(record);
    let url: URL; try { url = new URL(record.manifestOrigin); } catch { return untrusted(); }
    if (!id(record.sourceId) || url.protocol !== 'https:' || url.origin !== record.manifestOrigin || url.username || url.password
      || url.port || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname)
      || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(record.manifestPathPrefix) || !record.keys.length || record.keys.length > 8
      || new Set(record.keys.map(key => key.keyId)).size !== record.keys.length) untrusted();
    for (const key of record.keys) {
      if (!id(key.keyId) || typeof key.revoked !== 'boolean' || !key.spki.startsWith('-----BEGIN PUBLIC KEY-----')) untrusted();
      try { if (createPublicKey(key.spki).asymmetricKeyType !== 'ed25519') untrusted(); } catch { untrusted(); }
    }
  }
  async resolve(request: { packageId: string; packageVersion: string }, signal?: AbortSignal): Promise<DistributionEnvelope> {
    if (signal?.aborted) throw new DistributionError('CANCELLED');
    if (!id(request.packageId) || !id(request.packageVersion)) untrusted();
    const url = `${this.record.manifestOrigin}${this.record.manifestPathPrefix}${request.packageId}/${request.packageVersion}.json`;
    const timeout = AbortSignal.timeout(15000); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response | undefined;
    try {
      const loading = this.fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: combined,
        headers: { Accept: 'application/json' } });
      void loading.then(late => { if (combined.aborted) void late.body?.cancel().catch(() => {}); }, () => {});
      response = await interruptible(loading, combined);
      if (!response.ok || response.redirected || response.url && response.url !== url || !response.body) untrusted();
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_DISTRIBUTION_ENVELOPE_BYTES)) untrusted();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          if (combined.aborted) throw new Error('ABORTED');
          const read = await interruptible(reader.read(), combined); if (read.done) break;
          size += read.value.byteLength; if (size > MAX_DISTRIBUTION_ENVELOPE_BYTES) untrusted(); chunks.push(read.value);
        }
      } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* A bounded interrupted read may still hold its lock. */ } }
      const bytes = Buffer.concat(chunks); const envelope = parseDistributionEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
      const key = this.record.keys.find(entry => entry.keyId === envelope.signature.keyId && !entry.revoked);
      if (!key || request.packageId !== envelope.payload.packageId || request.packageVersion !== envelope.payload.packageVersion
        || !verify(null, Buffer.from(canonicalDistributionPayload(envelope.payload)), createPublicKey(key.spki), Buffer.from(envelope.signature.value, 'base64'))) untrusted();
      return envelope;
    } catch {
      if (signal?.aborted) throw new DistributionError('CANCELLED');
      return untrusted();
    } finally { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {}); }
  }
}
