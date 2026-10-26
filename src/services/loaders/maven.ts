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

/** Reads a SHA-1 sidecar and authoritative size from the exact admitted official Maven artifact URL. */
export async function readOfficialMavenProof(request: typeof fetch, url: string,
  signal?: AbortSignal): Promise<{ sha1: string; size: number; anchor: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new LoaderMavenError('CANCELLED');
    try { return await readOfficialMavenProofOnce(request, url, signal); }
    catch (error) {
      if (!(error instanceof LoaderMavenError) || error.code !== 'NETWORK_FAILED' || attempt === 2) throw error;
    }
  }
  throw new LoaderMavenError('NETWORK_FAILED');
}

async function readOfficialMavenProofOnce(request: typeof fetch, url: string,
  signal?: AbortSignal): Promise<{ sha1: string; size: number; anchor: string }> {
  if (!isArtifactUrl(url)) throw new LoaderMavenError('INVALID_METADATA');
  const controller = new AbortController(); const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { controller.abort(); }, 12000);
  try {
    const sidecar = await request(`${url}.sha1`, { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { accept: 'text/plain', 'accept-encoding': 'identity' } });
    const declared = sidecar.headers.get('content-length'); const encoding = sidecar.headers.get('content-encoding');
    if (sidecar.status !== 200 || !sidecar.body || declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SIDECAR_LIMIT)
      || encoding !== null && encoding !== 'identity') throw new LoaderMavenError('NETWORK_FAILED');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for await (const chunk of sidecar.body) { bytes += chunk.byteLength; if (bytes > SIDECAR_LIMIT) throw new LoaderMavenError('INVALID_METADATA'); chunks.push(chunk); }
    const body = Buffer.concat(chunks); const value = body.toString('ascii').trim();
    if (!/^[a-fA-F0-9]{40}$/.test(value)) throw new LoaderMavenError('INVALID_METADATA');
    const head = await request(url, { method: 'HEAD', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { 'accept-encoding': 'identity' } });
    const length = head.headers.get('content-length');
    if (head.status !== 200 || length === null || !/^\d+$/.test(length)) throw new LoaderMavenError('NETWORK_FAILED');
    const size = Number(length);
    if (!Number.isSafeInteger(size) || size < 1 || size > LIBRARY_LIMIT) throw new LoaderMavenError('INVALID_METADATA');
    return { sha1: value.toLowerCase(), size, anchor: createHash('sha256').update(body).digest('hex') };
  } catch (error) {
    if (error instanceof LoaderMavenError) throw error;
    throw new LoaderMavenError(controller.signal.aborted && signal?.aborted ? 'CANCELLED' : 'NETWORK_FAILED');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}
