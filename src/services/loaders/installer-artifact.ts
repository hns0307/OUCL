import type { InstallerLoaderKind } from '../../core/loaders/types.js';
import type { DownloadSpec } from '../download/types.js';
import type { LoaderCatalogDocument } from './metadata.js';
import { isOfficialLoaderMetadataUrl } from './metadata.js';
import { LoaderMavenError, readOfficialMavenProof } from './maven.js';

export function installerArtifactUrl(kind: InstallerLoaderKind, minecraftVersion: string, loaderVersion: string): string {
  if (kind === 'forge' && minecraftVersion === '1.20.1' && /^47\.\d+\.\d+$/.test(loaderVersion)) {
    const version = `${minecraftVersion}-${loaderVersion}`;
    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
  }
  if (kind === 'neoforge' && minecraftVersion === '1.21.1' && /^21\.1\.\d+$/.test(loaderVersion)) {
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }
  throw new LoaderMavenError('INVALID_METADATA');
}

export interface InstallerArtifactDocument { sourceUrl: string; spec: DownloadSpec; catalogSha256: string }

/** Converts an exact official catalog choice plus its Maven sidecar into a trusted installer download. */
export class InstallerArtifactResolver {
  constructor(private readonly request: typeof fetch = fetch) {}

  async resolve(kind: InstallerLoaderKind, minecraftVersion: string, loaderVersion: string,
    catalog: LoaderCatalogDocument, signal?: AbortSignal): Promise<InstallerArtifactDocument> {
    if (!isOfficialLoaderMetadataUrl(catalog.evidence.sourceUrl) || !/^[a-f0-9]{64}$/.test(catalog.evidence.sha256)
      || !catalog.items.some(item => item.kind === kind && item.minecraftVersion === minecraftVersion && item.loaderVersion === loaderVersion)) {
      throw new LoaderMavenError('INVALID_METADATA');
    }
    const sourceUrl = installerArtifactUrl(kind, minecraftVersion, loaderVersion);
    const proof = await readOfficialMavenProof(this.request, sourceUrl, signal);
    return { sourceUrl, catalogSha256: catalog.evidence.sha256,
      spec: { url: sourceUrl, expected: { algorithm: 'sha1', digest: proof.sha1, size: proof.size, provenanceId: `loader:${kind}:${proof.sha1}` },
        anchor: { kind: 'loader-maven', algorithm: 'sha256', digest: proof.anchor } } };
  }
}
