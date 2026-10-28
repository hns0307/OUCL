import { retryDelay } from '../network/backoff.js';
import { createHash } from 'node:crypto';
import type { LoaderProfile } from '../../core/loaders/types.js';
import type { DownloadSpec } from '../download/types.js';
import { isArtifactUrl } from '../download/types.js';
import { isOfficialLoaderMetadataUrl } from './metadata.js';
import type { LoaderMetadataEvidence } from './metadata.js';

const SIDECAR_LIMIT = 256;
const LIBRARY_LIMIT = 1024 ** 3;

export type LoaderMavenCode = 'INVALID_METADATA' | 'NETWORK_FAILED' | 'CANCELLED';
export class LoaderMavenError extends Error {
  readonly category: 'validation' | 'network' | 'cancelled';
  constructor(readonly code: LoaderMavenCode) {
    super(code); this.name = 'LoaderMavenError';
    this.category = code === 'INVALID_METADATA' ? 'validation' : code === 'CANCELLED' ? 'cancelled' : 'network';
  }
}
export interface LoaderLibraryDownload { path: string; spec: DownloadSpec }
export interface LoaderLibraryPlan { libraries: LoaderLibraryDownload[]; totalBytes: number }

function validEvidence(evidence: LoaderMetadataEvidence): boolean {
  return isOfficialLoaderMetadataUrl(evidence.sourceUrl) && evidence.sourceUrl.endsWith('/profile/json') && /^[a-f0-9]{64}$/.test(evidence.sha256);
}

/** Resolves missing library proofs only from the exact official Maven URL selected by a validated profile. */
export class LoaderMavenResolver {
  constructor(private readonly request: typeof fetch = fetch, private readonly concurrency = 4) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new LoaderMavenError('INVALID_METADATA');
  }

  async plan(profile: LoaderProfile, evidence: LoaderMetadataEvidence, signal?: AbortSignal): Promise<LoaderLibraryPlan> {
    if (!validEvidence(evidence) || profile.libraries.length > 256) throw new LoaderMavenError('INVALID_METADATA');
    const controller = new AbortController(); const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    const libraries = new Array<LoaderLibraryDownload>(profile.libraries.length); let next = 0;
    const lane = async (): Promise<void> => {
      try {
        while (next < profile.libraries.length) {
          const index = next++; const artifact = profile.libraries[index]!;
          if (controller.signal.aborted) throw new LoaderMavenError('CANCELLED');
          if (!isArtifactUrl(artifact.url)) throw new LoaderMavenError('INVALID_METADATA');
          if (artifact.proof === 'inline-sha1') {
            if (!artifact.sha1 || artifact.size === undefined || artifact.size > LIBRARY_LIMIT) throw new LoaderMavenError('INVALID_METADATA');
            libraries[index] = { path: artifact.path, spec: this.spec(profile, artifact.url, artifact.sha1, artifact.size, 'loader-profile', evidence.sha256) };
          } else {
            const proof = await readOfficialMavenProof(this.request, artifact.url, controller.signal);
            libraries[index] = { path: artifact.path, spec: this.spec(profile, artifact.url, proof.sha1, proof.size, 'loader-maven', proof.anchor) };
          }
        }
      } catch (error) { controller.abort(); throw error; }
    };
    try {
      const settled = await Promise.allSettled(Array.from({ length: Math.min(this.concurrency, profile.libraries.length) }, lane));
      const errors = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
      const failure = errors.find(error => error instanceof LoaderMavenError && error.code !== 'CANCELLED') ?? errors[0];
      if (failure !== undefined) throw failure instanceof LoaderMavenError ? failure : new LoaderMavenError('NETWORK_FAILED');
      const totalBytes = libraries.reduce((sum, item) => sum + item.spec.expected.size, 0);
      if (!Number.isSafeInteger(totalBytes)) throw new LoaderMavenError('INVALID_METADATA');
      return { libraries, totalBytes };
    } finally { signal?.removeEventListener('abort', abort); controller.abort(); }
  }

  private spec(profile: LoaderProfile, url: string, sha1: string, size: number, kind: 'loader-profile' | 'loader-maven', anchor: string): DownloadSpec {
    return { url, expected: { algorithm: 'sha1', digest: sha1, size, provenanceId: `loader:${profile.kind}:${sha1}` },
      anchor: { kind, algorithm: 'sha256', digest: anchor } };
  }

}

/** Reads independent bounded official checksum and size proofs without spending one request's deadline on the other. */
export async function readOfficialMavenProof(request: typeof fetch, url: string,
  signal?: AbortSignal): Promise<{ sha1: string; size: number; anchor: string }> {
  if (!isArtifactUrl(url)) throw new LoaderMavenError('INVALID_METADATA');
  const proof = await retryMavenRequest(async attemptSignal => {
    const response = await request(`${url}.sha1`, { method: 'GET', redirect: 'error', credentials: 'omit', signal: attemptSignal,
      headers: { accept: 'text/plain', 'accept-encoding': 'identity' } });
    try {
      const declared = response.headers.get('content-length'); const encoding = response.headers.get('content-encoding');
      if (response.status !== 200 || !response.body || declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SIDECAR_LIMIT)
        || encoding !== null && encoding !== 'identity') throw new LoaderMavenError('NETWORK_FAILED');
      const chunks: Uint8Array[] = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > SIDECAR_LIMIT) throw new LoaderMavenError('INVALID_METADATA'); chunks.push(chunk); }
      const body = Buffer.concat(chunks); const value = body.toString('ascii').trim();
      if (!/^[a-fA-F0-9]{40}$/.test(value)) throw new LoaderMavenError('INVALID_METADATA');
      return { sha1: value.toLowerCase(), anchor: createHash('sha256').update(body).digest('hex') };
    } finally { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }, signal);
  const size = await retryMavenRequest(async attemptSignal => {
    const response = await request(url, { method: 'HEAD', redirect: 'error', credentials: 'omit', signal: attemptSignal,
      headers: { 'accept-encoding': 'identity' } });
    try {
      const length = response.headers.get('content-length');
      if (response.status !== 200 || length === null || !/^\d+$/.test(length)) throw new LoaderMavenError('NETWORK_FAILED');
      const size = Number(length);
      if (!Number.isSafeInteger(size) || size < 1 || size > LIBRARY_LIMIT) throw new LoaderMavenError('INVALID_METADATA');
      return size;
    } finally { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }, signal);
  return { ...proof, size };
}

async function retryMavenRequest<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new LoaderMavenError('CANCELLED');
    const controller = new AbortController(); const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 12000);
    let failure: LoaderMavenError;
    try { const result = await operation(controller.signal); if (signal?.aborted) throw new LoaderMavenError('CANCELLED'); return result; }
    catch (error) { failure = signal?.aborted ? new LoaderMavenError('CANCELLED') : error instanceof LoaderMavenError ? error : new LoaderMavenError('NETWORK_FAILED'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
    if (failure.code !== 'NETWORK_FAILED' || attempt >= 2) throw failure;
    try { await retryDelay(attempt, signal); } catch { throw new LoaderMavenError('CANCELLED'); }
  }
}
