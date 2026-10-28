import { retryDelay } from '../network/backoff.js';
import { createHash } from 'node:crypto';
import { isOfficialMetadataUrl } from '../../core/version/manifest.js';

export type CatalogCode = 'CATALOG_UNAVAILABLE' | 'UNTRUSTED_MANIFEST' | 'INVALID_ARGUMENT';
/** Redacted network/metadata failure without response bodies, addresses or raw exceptions. */
export class CatalogError extends Error {
  readonly category = 'network';
  constructor(readonly code: CatalogCode, readonly retryable = true) { super(code); this.name = 'CatalogError'; }
}
export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export interface JsonDocument { body: string; sha1: string; sha256: string }
export interface MetadataReader { read(url: string, expectedSha1?: string): Promise<JsonDocument> }

/** Bounded HTTPS transport. Inject fetch for deterministic tests; redirects/credentials are disabled. */
export class OfficialMetadataReader implements MetadataReader {
  constructor(private readonly request: typeof fetch = fetch, private readonly accepts: (url: string) => boolean = isOfficialMetadataUrl) {}
  async read(url: string, expectedSha1?: string): Promise<JsonDocument> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.readOnce(url, expectedSha1); }
      catch (error) {
        if (!(error instanceof CatalogError) || error.code !== 'CATALOG_UNAVAILABLE' || !error.retryable || attempt >= 2) throw error;
        await retryDelay(attempt);
      }
    }
  }
  private async readOnce(url: string, expectedSha1?: string): Promise<JsonDocument> {
    if (!this.accepts(url) || expectedSha1 !== undefined && !/^[a-f0-9]{40}$/.test(expectedSha1)) throw new CatalogError('UNTRUSTED_MANIFEST');
    const controller = new AbortController(); const deadline = setTimeout(() => { controller.abort(); }, 12000);
    let response: Response | undefined;
    try {
      response = await this.request(url, { signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { accept: 'application/json', 'accept-encoding': 'identity' } });
      if (response.status !== 200 || !response.body) throw new CatalogError('CATALOG_UNAVAILABLE', response.status === 408 || response.status >= 500);
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 2 * 1024 * 1024)) throw new CatalogError('UNTRUSTED_MANIFEST');
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 2 * 1024 * 1024) throw new CatalogError('UNTRUSTED_MANIFEST');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks); const sha1 = createHash('sha1').update(bytes).digest('hex');
      if (expectedSha1 !== undefined && sha1 !== expectedSha1) throw new CatalogError('UNTRUSTED_MANIFEST');
      // Fatal decoding prevents malformed byte sequences from being silently replaced before JSON parsing.
      let body: string;
      try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new CatalogError('UNTRUSTED_MANIFEST'); }
      return { body, sha1, sha256: createHash('sha256').update(bytes).digest('hex') };
    } catch (error) { throw error instanceof CatalogError ? error : new CatalogError('CATALOG_UNAVAILABLE'); }
    finally { controller.abort(); clearTimeout(deadline); if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }
}
