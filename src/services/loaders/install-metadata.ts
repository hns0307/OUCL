import type { VersionEnvironment } from '../../core/version/types.js';
import { createHash } from 'node:crypto';
import type { PreparedInstallMetadata } from '../catalog/install-metadata.js';
import type { InstallMetadataService } from '../catalog/install-metadata.js';
import { CatalogError } from '../catalog/transport.js';
import type { LoaderProfile } from '../../core/loaders/types.js';
import { parseLoaderProfile } from '../../core/loaders/metadata.js';
import type { LoaderKind } from '../../shared/contracts/loaders.js';
import { composeLoaderInstall } from './compose.js';
import type { LoaderMetadataClient, LoaderMetadataEvidence } from './metadata.js';
import type { LoaderLibraryPlan, LoaderMavenResolver } from './maven.js';

type MetadataLoaderKind = Extract<LoaderKind, 'fabric' | 'quilt'>;
export interface PreparedLoaderMetadata extends PreparedInstallMetadata {
  loader: {
    kind: MetadataLoaderKind;
    version: string;
    profileBody: string;
    profileEvidence: LoaderMetadataEvidence;
    libraries: LoaderLibraryPlan;
    derivedDocument: string;
    environment: VersionEnvironment;
  };
}

/** Rebuilds a loader plan from its original bytes and independently validated Maven facts. */
export function rebuildPreparedLoaderPlan(metadata: PreparedLoaderMetadata) {
  const profile = parseStoredLoaderProfile(metadata.loader.kind, metadata.version.ancestry[0] ?? '', metadata.loader.version,
    metadata.loader.profileBody, metadata.loader.profileEvidence.sha256);
  return composeLoaderInstall({ baseVersionDocuments: metadata.versionDocuments, baseMetadataSha1ByVersion: metadata.metadataSha1ByVersion,
    assets: metadata.assets, profile, profileSha256: metadata.loader.profileEvidence.sha256, libraries: metadata.loader.libraries,
    environment: metadata.loader.environment }).plan;
}

/** Builds a complete loader plan without writing files or selecting an unrequested version. */
export class LoaderInstallMetadataService {
  constructor(private readonly vanilla: Pick<InstallMetadataService, 'prepare'>,
    private readonly metadata: Pick<LoaderMetadataClient, 'profile'>,
    private readonly maven: Pick<LoaderMavenResolver, 'plan'>) {}

  async prepare(kind: MetadataLoaderKind, minecraftVersion: string, loaderVersion: string,
    environment: VersionEnvironment, signal?: AbortSignal): Promise<PreparedLoaderMetadata> {
    if (environment.os !== 'windows' || environment.arch !== 'x64' || signal?.aborted) throw new CatalogError('INVALID_ARGUMENT');
    try {
      const [base, loader] = await Promise.all([
        this.vanilla.prepare(minecraftVersion, environment),
        this.metadata.profile(kind, minecraftVersion, loaderVersion)
      ]);
      if (signal?.aborted) throw new CatalogError('CATALOG_UNAVAILABLE');
      const libraries = await this.maven.plan(loader.profile, loader.evidence, signal);
      const composed = composeLoaderInstall({ baseVersionDocuments: base.versionDocuments, baseMetadataSha1ByVersion: base.metadataSha1ByVersion,
        assets: base.assets, profile: loader.profile, profileSha256: loader.evidence.sha256, libraries, environment });
      return { ...base, version: composed.version, plan: composed.plan, loader: { kind, version: loaderVersion,
        profileBody: loader.body, profileEvidence: loader.evidence, libraries, derivedDocument: composed.loaderDocument, environment } };
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNTRUSTED_MANIFEST');
    }
  }
}

/** Revalidates persisted profile bytes before any resume path trusts their parsed projection. */
export function parseStoredLoaderProfile(kind: MetadataLoaderKind, minecraftVersion: string, loaderVersion: string,
  body: string, expectedSha256: string): LoaderProfile {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new CatalogError('UNTRUSTED_MANIFEST');
  if (createHash('sha256').update(body).digest('hex') !== expectedSha256) throw new CatalogError('UNTRUSTED_MANIFEST');
  try { return parseLoaderProfile(kind, minecraftVersion, loaderVersion, JSON.parse(body) as unknown); }
  catch { throw new CatalogError('UNTRUSTED_MANIFEST'); }
}

