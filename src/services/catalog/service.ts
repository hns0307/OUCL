import { parseManifest } from '../../core/version/manifest.js';
import type { ManifestEntry } from '../../core/version/manifest.js';
import { resolveClientVersion } from '../../core/version/resolve.js';
import type { ResolvedClientVersion, VersionEnvironment } from '../../core/version/types.js';
import type { RecordEnvelope } from '../storage/records.js';
import { parseCatalogCache } from '../storage/catalog-cache.js';
import type { CatalogCache } from '../storage/catalog-cache.js';
import { CatalogError, MANIFEST_URL } from './transport.js';
import type { MetadataReader } from './transport.js';

export interface CatalogQuery { channel: 'release' | 'snapshot' | 'old'; limit: number; cursor?: string }
export interface CatalogItem { mcVersionId: string; type: ManifestEntry['type']; releaseTime: string; status: 'candidate' }
export interface CatalogPage { page: { items: CatalogItem[]; nextCursor?: string }; fetchedAt: string; cached: boolean }
interface Repository {
  readCatalog(): Promise<RecordEnvelope<CatalogCache> | undefined>;
  writeCatalog(expectedRevision: number, data: CatalogCache): Promise<RecordEnvelope<CatalogCache>>;
}
interface Loaded { entries: ManifestEntry[]; cache: CatalogCache; cached: boolean }

/** Official catalog and descriptor trust chain, with bounded shared refresh and explicit cached timestamps. */
export class CatalogService {
  private loaded: Loaded | undefined;
  private loading: Promise<Loaded> | undefined;
  private retryAt = 0;
  constructor(private readonly reader: MetadataReader, private readonly repository: Repository, private readonly now: () => number = Date.now) {}
  private load(): Promise<Loaded> {
    if (this.loaded && (this.now() < this.retryAt || this.now() - Date.parse(this.loaded.cache.fetchedAt) >= 0 && this.now() - Date.parse(this.loaded.cache.fetchedAt) < 300000)) return Promise.resolve({ ...this.loaded, cached: true });
    if (this.loading) return this.loading;
    const pending = this.refresh(); this.loading = pending;
    void pending.finally(() => { if (this.loading === pending) this.loading = undefined; }).catch(() => {});
    return pending;
  }
  private async refresh(): Promise<Loaded> {
    let stored: RecordEnvelope<CatalogCache> | undefined;
    try { stored = await this.repository.readCatalog(); } catch { throw new CatalogError('CATALOG_UNAVAILABLE'); }
    let cached: Loaded | undefined;
    if (stored) {
      try {
        const cache = parseCatalogCache(stored.data);
        if (Date.parse(cache.fetchedAt) > this.now() + 60000) throw new CatalogError('UNTRUSTED_MANIFEST');
        cached = { entries: parseManifest(JSON.parse(cache.body) as unknown), cache, cached: true };
      } catch { throw new CatalogError('UNTRUSTED_MANIFEST'); }
      if (this.now() - Date.parse(cached.cache.fetchedAt) < 300000) { this.loaded = cached; return cached; }
    }
    try {
      const document = await this.reader.read(MANIFEST_URL);
      let entries: ManifestEntry[]; let cache: CatalogCache;
      try {
        entries = parseManifest(JSON.parse(document.body) as unknown);
        cache = parseCatalogCache({ body: document.body, sha256: document.sha256, fetchedAt: new Date(this.now()).toISOString() });
      } catch { throw new CatalogError('UNTRUSTED_MANIFEST'); }
      try { await this.repository.writeCatalog(stored?.revision ?? 0, cache); } catch { throw new CatalogError('CATALOG_UNAVAILABLE'); }
      this.loaded = { entries, cache, cached: false }; return this.loaded;
    } catch (error) {
      if (cached && !(error instanceof CatalogError && error.code === 'UNTRUSTED_MANIFEST')) { this.loaded = cached; this.retryAt = this.now() + 30000; return cached; }
      throw error instanceof CatalogError ? error : new CatalogError('UNTRUSTED_MANIFEST');
    }
  }
  /** Paginates a validated catalog. Candidate means not yet verified to launch on the target matrix. */
  async list(query: CatalogQuery): Promise<CatalogPage> {
    if (!['release', 'snapshot', 'old'].includes(query.channel) || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new CatalogError('INVALID_ARGUMENT');
    const loaded = await this.load(); let offset = 0;
    if (query.cursor !== undefined) {
      const parts = /^v1\.([a-f0-9]{64})\.(release|snapshot|old)\.(0|[1-9][0-9]{0,5})$/.exec(query.cursor);
      if (!parts || parts[1] !== loaded.cache.sha256 || parts[2] !== query.channel) throw new CatalogError('INVALID_ARGUMENT');
      offset = Number(parts[3]);
    }
    const items = loaded.entries.filter(entry => query.channel === 'old' ? entry.type === 'old_alpha' || entry.type === 'old_beta' : entry.type === query.channel);
    if (offset > items.length) throw new CatalogError('INVALID_ARGUMENT');
    const end = Math.min(offset + query.limit, items.length);
    return { page: { items: items.slice(offset, end).map(entry => ({ mcVersionId: entry.id, type: entry.type, releaseTime: entry.releaseTime, status: 'candidate' })),
      ...(end < items.length ? { nextCursor: `v1.${loaded.cache.sha256}.${query.channel}.${end}` } : {}) }, fetchedAt: loaded.cache.fetchedAt, cached: loaded.cached };
  }
  /** Resolves only descriptors found in the official manifest, verifying SHA1 before parsing or inheriting. */
  async resolve(id: string, environment: VersionEnvironment): Promise<{ version: ResolvedClientVersion; metadataSha1: string; metadataSha1ByVersion: Record<string, string> }> {
    const loaded = await this.load(); const documents: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const entries = new Map(loaded.entries.map(entry => [entry.id, entry]));
    let next: string | undefined = id; let metadataSha1 = '';
    const metadataSha1ByVersion: Record<string, string> = Object.create(null) as Record<string, string>;
    try {
      while (next !== undefined) {
        if (Object.hasOwn(documents, next) || Object.keys(documents).length >= 32) throw new CatalogError('UNTRUSTED_MANIFEST');
        const entry = entries.get(next); if (!entry) throw new CatalogError('INVALID_ARGUMENT');
        const document = await this.reader.read(entry.url, entry.sha1);
        if (document.sha1 !== entry.sha1) throw new CatalogError('UNTRUSTED_MANIFEST');
        metadataSha1ByVersion[next] = document.sha1;
        if (!metadataSha1) metadataSha1 = document.sha1;
        const value: unknown = JSON.parse(document.body); documents[next] = value;
        if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== next) throw new CatalogError('UNTRUSTED_MANIFEST');
        next = 'inheritsFrom' in value && typeof value.inheritsFrom === 'string' ? value.inheritsFrom : undefined;
      }
      return { version: resolveClientVersion(id, documents, environment), metadataSha1, metadataSha1ByVersion };
    } catch (error) { throw error instanceof CatalogError ? error : new CatalogError('UNTRUSTED_MANIFEST'); }
  }
}
