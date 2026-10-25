import { parseLoaderCatalog, parseLoaderProfile } from '../../core/loaders/metadata.js';
import type { LoaderProfile, LoaderVersionSummary } from '../../core/loaders/types.js';
import { CatalogError } from '../catalog/transport.js';
import type { MetadataReader } from '../catalog/transport.js';

type MetadataKind = 'fabric' | 'quilt';
const SEGMENT = '[a-zA-Z0-9_.+-]+';
const ENDPOINTS: Record<MetadataKind, { origin: string; api: string }> = {
  fabric: { origin: 'https://meta.fabricmc.net', api: 'v2' },
  quilt: { origin: 'https://meta.quiltmc.org', api: 'v3' }
};

export interface LoaderMetadataEvidence {
  sourceUrl: string;
  sha256: string;
}
export interface LoaderCatalogDocument { items: LoaderVersionSummary[]; evidence: LoaderMetadataEvidence }
export interface LoaderProfileDocument { profile: LoaderProfile; evidence: LoaderMetadataEvidence }

function safeSegment(value: string): boolean {
  return value.length >= 1 && value.length <= 160 && new RegExp(`^${SEGMENT}$`).test(value);
}

/** Allows only the two documented loader metadata endpoint shapes. */
export function isOfficialLoaderMetadataUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false;
  for (const { origin, api } of Object.values(ENDPOINTS)) {
    if (url.origin === origin && new RegExp(`^/${api}/versions/loader/${SEGMENT}(?:/${SEGMENT}/profile/json)?$`).test(url.pathname)) return true;
  }
  return false;
}

function endpoint(kind: MetadataKind, minecraftVersion: string, loaderVersion?: string): string {
  if (!safeSegment(minecraftVersion) || loaderVersion !== undefined && !safeSegment(loaderVersion)) throw new CatalogError('INVALID_ARGUMENT');
  const source = ENDPOINTS[kind];
  return `${source.origin}/${source.api}/versions/loader/${minecraftVersion}${loaderVersion === undefined ? '' : `/${loaderVersion}/profile/json`}`;
}

function json(body: string): unknown {
  try { return JSON.parse(body) as unknown; } catch { throw new CatalogError('UNTRUSTED_MANIFEST'); }
}

/** Reads bounded official Fabric/Quilt documents; it performs no version selection or installation. */
export class LoaderMetadataClient {
  constructor(private readonly reader: MetadataReader) {}

  async catalog(kind: MetadataKind, minecraftVersion: string): Promise<LoaderCatalogDocument> {
    const sourceUrl = endpoint(kind, minecraftVersion);
    const document = await this.reader.read(sourceUrl);
    try {
      return { items: parseLoaderCatalog(kind, minecraftVersion, json(document.body)), evidence: { sourceUrl, sha256: document.sha256 } };
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNTRUSTED_MANIFEST');
    }
  }

  async profile(kind: MetadataKind, minecraftVersion: string, loaderVersion: string): Promise<LoaderProfileDocument> {
    const sourceUrl = endpoint(kind, minecraftVersion, loaderVersion);
    const document = await this.reader.read(sourceUrl);
    try {
      return { profile: parseLoaderProfile(kind, minecraftVersion, loaderVersion, json(document.body)), evidence: { sourceUrl, sha256: document.sha256 } };
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNTRUSTED_MANIFEST');
    }
  }
}
