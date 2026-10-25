import { parseInstallerCatalog, parseLoaderCatalog, parseLoaderProfile } from '../../core/loaders/metadata.js';
import type { LoaderProfile, LoaderVersionSummary } from '../../core/loaders/types.js';
import type { LoaderKind } from '../../core/loaders/types.js';
import { CatalogError } from '../catalog/transport.js';
import type { MetadataReader } from '../catalog/transport.js';

type MetadataKind = 'fabric' | 'quilt';
type CatalogKind = LoaderKind;
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
export interface LoaderProfileDocument { profile: LoaderProfile; evidence: LoaderMetadataEvidence; body: string }

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
  return url.href === 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
    || url.href === 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
}

function endpoint(kind: MetadataKind, minecraftVersion: string, loaderVersion?: string): string {
  if (!safeSegment(minecraftVersion) || loaderVersion !== undefined && !safeSegment(loaderVersion)) throw new CatalogError('INVALID_ARGUMENT');
  const source = ENDPOINTS[kind];
  return `${source.origin}/${source.api}/versions/loader/${minecraftVersion}${loaderVersion === undefined ? '' : `/${loaderVersion}/profile/json`}`;
}

function catalogEndpoint(kind: CatalogKind, minecraftVersion: string): string {
  if (!safeSegment(minecraftVersion)) throw new CatalogError('INVALID_ARGUMENT');
  if (kind === 'forge') return 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
  if (kind === 'neoforge') {
    if (minecraftVersion !== '1.21.1') throw new CatalogError('INVALID_ARGUMENT');
    return 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
  }
  return endpoint(kind, minecraftVersion);
}

function json(body: string): unknown {
  try { return JSON.parse(body) as unknown; } catch { throw new CatalogError('UNTRUSTED_MANIFEST'); }
}

/** Reads bounded official loader catalogs and Fabric/Quilt profiles; it performs no installation. */
export class LoaderMetadataClient {
  constructor(private readonly reader: MetadataReader) {}

  async catalog(kind: CatalogKind, minecraftVersion: string): Promise<LoaderCatalogDocument> {
    const sourceUrl = catalogEndpoint(kind, minecraftVersion);
    const document = await this.reader.read(sourceUrl);
    try {
      const value = json(document.body);
      return { items: kind === 'fabric' || kind === 'quilt' ? parseLoaderCatalog(kind, minecraftVersion, value)
        : parseInstallerCatalog(kind, minecraftVersion, value), evidence: { sourceUrl, sha256: document.sha256 } };
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNTRUSTED_MANIFEST');
    }
  }

  async profile(kind: MetadataKind, minecraftVersion: string, loaderVersion: string): Promise<LoaderProfileDocument> {
    const sourceUrl = endpoint(kind, minecraftVersion, loaderVersion);
    const document = await this.reader.read(sourceUrl);
    try {
      return { profile: parseLoaderProfile(kind, minecraftVersion, loaderVersion, json(document.body)), evidence: { sourceUrl, sha256: document.sha256 }, body: document.body };
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNTRUSTED_MANIFEST');
    }
  }
}
