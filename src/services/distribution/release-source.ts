import { createHash, createPublicKey, verify } from 'node:crypto';
import { canonicalDistributionPayload, parseDistributionManifest } from '../../core/distribution/manifest.js';
import type { DistributionManifest } from '../../core/distribution/manifest.js';
import { canonicalDistributionReleasePayload, checkDistributionReleaseTime, parseDistributionReleaseEnvelope, ReleaseError } from '../../core/distribution/release.js';
import type { DistributionReleaseEnvelope } from '../../core/distribution/release.js';
import { MAX_DISTRIBUTION_ENVELOPE_BYTES, PinnedDistributionSource } from './source.js';
import type { TrustedDistributionSource } from './source.js';

export interface ReleaseScope { sourceId: string; packageId: string }
export interface ReleaseState { sequence: number; releaseSha256: string }
/** Main-owned authoritative store: both methods must be serialized/transactional across processes.
 * Missing is allowed only for a genuinely new scope. Corruption, lost authority or unknown recovery must reject.
 * compareAndSet atomically compares BOTH expected fields (or true absence); false means no mutation.
 * Accepted release sequence is independent of installation receipts and is never rolled back with a failed install.
 */
export interface ReleaseStateStore {
  read(scope: ReleaseScope): Promise<ReleaseState | undefined>;
  compareAndSet(scope: ReleaseScope, expected: ReleaseState | undefined, next: ReleaseState): Promise<boolean>;
}
export interface ReleaseSourceOptions { fetcher?: typeof fetch; now?: () => number; timeoutMs?: number }
export interface ReleaseRequest { packageId: string; packageVersion: string; target: DistributionManifest['target'] }
export interface AcceptedDistributionRelease { envelope: DistributionReleaseEnvelope; releaseSha256: string }
/** No publisher keys or URLs are invented; enabling v2 requires an explicit trusted source AND authoritative store. */
export const EMPTY_RELEASE_SOURCES: readonly TrustedDistributionSource[] = Object.freeze([]);
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
function validState(value: ReleaseState | undefined): void {
  if (value !== undefined && (typeof value !== 'object' || value === null || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'sequence') || !Object.hasOwn(value, 'releaseSha256')
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.releaseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.releaseSha256))) throw new ReleaseError('RELEASE_STATE_INVALID');
}

/** Separate execution-oriented release protocol. V1 preview and its signature bytes are unchanged. */
export class PinnedReleaseSource {
  private readonly record: TrustedDistributionSource;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(record: TrustedDistributionSource, private readonly state: ReleaseStateStore, options: ReleaseSourceOptions = {}) {
    // Reuse the exact existing HTTPS/origin/path/pinned-Ed25519 trust-record validation without sending a request.
    try { new PinnedDistributionSource(record); } catch { throw new ReleaseError('UNTRUSTED_RELEASE'); }
    this.record = structuredClone(record); this.timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 15000) throw new ReleaseError('INVALID_RELEASE');
    this.fetcher = options.fetcher ?? fetch; this.now = options.now ?? Date.now;
  }

  async resolve(request: ReleaseRequest, signal?: AbortSignal): Promise<AcceptedDistributionRelease> {
    if (signal?.aborted) throw new ReleaseError('CANCELLED');
    if (![request.packageId, request.packageVersion].every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value))) throw new ReleaseError('INVALID_RELEASE');
    const controller = new AbortController();
    let response: Response | undefined; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stopped = false; let rejectStop: ((error: ReleaseError) => void) | undefined;
    const stop = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    void stop.catch(() => {});
    const interrupt = (error: ReleaseError): void => { stopped = true; rejectStop?.(error); controller.abort(); };
    const abort = (): void => { interrupt(new ReleaseError('CANCELLED')); };
    const check = (): void => { if (stopped || controller.signal.aborted) throw new ReleaseError(signal?.aborted ? 'CANCELLED' : 'RELEASE_TIMEOUT'); };
    const bounded = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, stop]);
    const authority = async <T>(operation: () => Promise<T>): Promise<T> => {
      try { return await bounded(Promise.resolve().then(operation)); }
      catch (error) { if (error instanceof ReleaseError) throw error; throw new ReleaseError('RELEASE_STATE_INVALID'); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { interrupt(new ReleaseError('RELEASE_TIMEOUT')); }, this.timeoutMs);
    if (signal?.aborted) abort();
    try {
      const url = `${this.record.manifestOrigin}${this.record.manifestPathPrefix}${request.packageId}/${request.packageVersion}/release-v2.json`;
      const loading = this.fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' } });
      // A misbehaving injected fetch may finish after timeout. Cancel its eventual body without awaiting cleanup.
      void loading.then(late => { if (stopped) void late.body?.cancel().catch(() => {}); }, () => {});
      response = await bounded(loading); check();
      if (!response.ok || response.redirected || response.url && response.url !== url || !response.body) throw new ReleaseError('UNTRUSTED_RELEASE');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_DISTRIBUTION_ENVELOPE_BYTES)) throw new ReleaseError('INVALID_RELEASE');
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        check(); const part = await bounded(reader.read()); if (part.done) break;
        size += part.value.byteLength; if (size > MAX_DISTRIBUTION_ENVELOPE_BYTES) throw new ReleaseError('INVALID_RELEASE'); chunks.push(part.value);
      }
      const envelope = parseDistributionReleaseEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown);
      const payload = envelope.payload; const key = this.record.keys.find(entry => entry.keyId === envelope.signature.keyId && !entry.revoked);
      const canonical = canonicalDistributionReleasePayload(payload);
      if (!key || envelope.signature.value !== Buffer.from(envelope.signature.value, 'base64').toString('base64')
        || !verify(null, Buffer.from(canonical), createPublicKey(key.spki), Buffer.from(envelope.signature.value, 'base64'))
        || payload.sourceId !== this.record.sourceId || payload.packageId !== request.packageId || payload.packageVersion !== request.packageVersion
        || digest(canonicalDistributionPayload(payload.manifest)) !== payload.manifestSha256) throw new ReleaseError('UNTRUSTED_RELEASE');
      const target = parseDistributionManifest({ ...payload.manifest, target: request.target }).target;
      if (JSON.stringify(target) !== JSON.stringify(payload.manifest.target)) throw new ReleaseError('UNTRUSTED_RELEASE');
      checkDistributionReleaseTime(payload, this.now()); check();
      const scope = { sourceId: payload.sourceId, packageId: payload.packageId }; const releaseSha256 = digest(canonical);
      const next: ReleaseState = { sequence: payload.sequence, releaseSha256 };
      for (let attempt = 0; attempt < 8; attempt++) {
        check(); const observed = await authority(() => this.state.read(scope)); validState(observed);
        const previous = observed ? { ...observed } : undefined; check(); checkDistributionReleaseTime(payload, this.now());
        if (previous && payload.sequence < previous.sequence) throw new ReleaseError('RELEASE_DOWNGRADE');
        if (previous && payload.sequence === previous.sequence) {
          if (previous.releaseSha256 !== releaseSha256) throw new ReleaseError('RELEASE_EQUIVOCATION');
        }
        const accepted = await authority(() => this.state.compareAndSet(scope, previous ? { ...previous } : undefined, { ...next }));
        check(); checkDistributionReleaseTime(payload, this.now());
        if (typeof accepted !== 'boolean') throw new ReleaseError('RELEASE_STATE_INVALID');
        if (accepted) return { envelope, releaseSha256 };
      }
      throw new ReleaseError('RELEASE_STATE_CONFLICT');
    } catch (error) {
      if (error instanceof ReleaseError) throw error;
      if (signal?.aborted) throw new ReleaseError('CANCELLED');
      throw new ReleaseError('UNTRUSTED_RELEASE');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      stopped = true; controller.abort();
      // Never wait for a hostile stream's cancellation promise. Attaching handlers prevents unhandled rejections.
      if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* An outstanding timed-out read still owns the lock. */ } }
      else if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  }
}
