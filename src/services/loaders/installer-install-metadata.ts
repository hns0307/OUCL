import { createHash } from 'node:crypto';
import { parseInstallerProfile } from '../../core/loaders/installer-profile.js';
import type { InstallerLoaderKind } from '../../core/loaders/types.js';
import type { VersionEnvironment } from '../../core/version/types.js';
import type { PreparedInstallMetadata } from '../catalog/install-metadata.js';
import type { ObjectRef } from '../objects/store.js';
import { sourceKey } from '../objects/provenance.js';
import type { PersistedInstallerLoaderMetadata } from '../storage/instance-records.js';
import { composeInstallerInstall } from './installer-compose.js';
import type { InstallerArtifactDocument } from './installer-artifact.js';
import type { LoaderCatalogDocument } from './metadata.js';

export interface PreparedInstallerMetadata extends PreparedInstallMetadata { loader: PersistedInstallerLoaderMetadata }

/** Builds the durable installer checkpoint only from a selected official candidate and verified installer object. */
export function assembleInstallerMetadata(kind: InstallerLoaderKind, minecraftVersion: string, loaderVersion: string,
  environment: VersionEnvironment, base: PreparedInstallMetadata, catalog: LoaderCatalogDocument, artifact: InstallerArtifactDocument,
  installerObject: ObjectRef, profileBody: string, versionBody: string): PreparedInstallerMetadata {
  if (artifact.catalogSha256 !== catalog.evidence.sha256 || !catalog.items.some(item => item.kind === kind
    && item.minecraftVersion === minecraftVersion && item.loaderVersion === loaderVersion)
    || installerObject.size !== artifact.spec.expected.size || installerObject.sourceKey !== sourceKey(artifact.spec.expected, artifact.spec.anchor)) {
    throw new Error('INVALID_INSTALLER_METADATA');
  }
  const profileSha256 = createHash('sha256').update(profileBody).digest('hex');
  const versionSha256 = createHash('sha256').update(versionBody).digest('hex');
  let profile;
  try { profile = parseInstallerProfile(kind, minecraftVersion, loaderVersion, JSON.parse(profileBody) as unknown, JSON.parse(versionBody) as unknown); }
  catch { throw new Error('INVALID_INSTALLER_METADATA'); }
  const composed = composeInstallerInstall({ baseVersionDocuments: base.versionDocuments, baseMetadataSha1ByVersion: base.metadataSha1ByVersion,
    assets: base.assets, profile, profileSha256, environment });
  const loader: PersistedInstallerLoaderMetadata = { kind, version: loaderVersion, catalogSourceUrl: catalog.evidence.sourceUrl,
    catalogSha256: catalog.evidence.sha256, installer: { sourceUrl: artifact.sourceUrl, spec: artifact.spec, object: installerObject },
    profileBody, profileSha256, versionBody, versionSha256, libraries: profile.libraries.map(library => ({ path: library.path, spec: {
      url: library.url, expected: { algorithm: 'sha1', digest: library.sha1, size: library.size, provenanceId: `loader:${kind}:${library.sha1}` },
      anchor: { kind: 'loader-profile', algorithm: 'sha256', digest: profileSha256 } } })) };
  return { ...base, version: composed.version, plan: composed.plan, loader };
}
