import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import type { InstallerLoaderKind } from '../../core/loaders/types.js';
import type { VersionEnvironment } from '../../core/version/types.js';
import type { InstallMetadataService } from '../catalog/install-metadata.js';
import type { DownloadCoordinator } from '../download/coordinator.js';
import type { ObjectStore, ObjectRef } from '../objects/store.js';
import type { FileViewService } from '../install/file-views.js';
import { ensureChildDirectory } from '../install/instance-files.js';
import { guardDirectory, readRegular } from '../storage/files.js';
import type { InstallerArchiveExtractor } from '../workers/installer-archive-extractor.js';
import type { PersistedInstallerLoaderMetadata } from '../storage/instance-records.js';
import type { LoaderMetadataClient } from './metadata.js';
import type { InstallerArtifactResolver } from './installer-artifact.js';
import { assembleInstallerMetadata } from './installer-install-metadata.js';

export class InstallerPreparationError extends Error {
  readonly category: 'validation' | 'cancelled' | 'disk';
  constructor(readonly code: 'INVALID_INSTALLER_METADATA' | 'CANCELLED' | 'NEEDS_RECOVERY') {
    super(code); this.name = 'InstallerPreparationError'; this.category = code === 'CANCELLED' ? 'cancelled'
      : code === 'NEEDS_RECOVERY' ? 'disk' : 'validation';
  }
}
export interface InstallerPreparationRuntime {
  dataDirectory: string; coordinator: Pick<DownloadCoordinator, 'request'>; objects: Pick<ObjectStore, 'lookup'>;
  views: Pick<FileViewService, 'materialize'>; extractor: Pick<InstallerArchiveExtractor, 'run'>;
}
export interface ExtractedInstaller { workspace: string; profileBody: string; versionBody: string }
const cancelled = (signal: AbortSignal): void => { if (signal.aborted) throw new InstallerPreparationError('CANCELLED'); };

async function document(file: string): Promise<string> {
  const bytes = await readRegular(file, 2 * 1024 ** 2);
  if (!bytes || !bytes.length) throw new InstallerPreparationError('INVALID_INSTALLER_METADATA');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new InstallerPreparationError('INVALID_INSTALLER_METADATA'); }
}

/** Reuses the existing object owner; failed workspaces remain private recovery material. */
export class InstallerPreparationService {
  constructor(private readonly vanilla: Pick<InstallMetadataService, 'prepare'>,
    private readonly catalogs: Pick<LoaderMetadataClient, 'catalog'>,
    private readonly artifacts: Pick<InstallerArtifactResolver, 'resolve'>) {}

  async prepare(kind: InstallerLoaderKind, minecraftVersion: string, loaderVersion: string, environment: VersionEnvironment,
    consumerId: string, runtime: InstallerPreparationRuntime, signal: AbortSignal) {
    cancelled(signal);
    const catalog = await this.catalogs.catalog(kind, minecraftVersion); cancelled(signal);
    const artifact = await this.artifacts.resolve(kind, minecraftVersion, loaderVersion, catalog, signal); cancelled(signal);
    const object = await runtime.coordinator.request(artifact.spec, { consumerId, signal }).result; cancelled(signal);
    const extracted = await this.extract({ sourceUrl: artifact.sourceUrl, spec: artifact.spec, object }, runtime, signal);
    const base = await this.vanilla.prepare(minecraftVersion, environment); cancelled(signal);
    const metadata = assembleInstallerMetadata(kind, minecraftVersion, loaderVersion, environment, base, catalog, artifact, object,
      extracted.profileBody, extracted.versionBody);
    return { metadata, workspace: extracted.workspace };
  }

  /** Recovery re-reads the authenticated installer object and compares exact document bytes. */
  async reopen(loader: Pick<PersistedInstallerLoaderMetadata, 'installer' | 'profileBody' | 'versionBody'>,
    runtime: InstallerPreparationRuntime, signal: AbortSignal): Promise<ExtractedInstaller> {
    const extracted = await this.extract(loader.installer, runtime, signal);
    if (extracted.profileBody !== loader.profileBody || extracted.versionBody !== loader.versionBody) throw new InstallerPreparationError('NEEDS_RECOVERY');
    return extracted;
  }

  private async extract(installer: PersistedInstallerLoaderMetadata['installer'], runtime: InstallerPreparationRuntime,
    signal: AbortSignal): Promise<ExtractedInstaller> {
    cancelled(signal);
    const verified = await runtime.objects.lookup(installer.spec.expected, installer.spec.anchor); cancelled(signal);
    if (!verified || !sameObject(verified, installer.object)) throw new InstallerPreparationError('NEEDS_RECOVERY');
    const parent = await ensureChildDirectory(runtime.dataDirectory, 'staging', 'loader-installers');
    const workspace = await mkdtemp(path.join(parent, 'preparing-')); await guardDirectory(workspace); cancelled(signal);
    await runtime.views.materialize(workspace, 'installer.jar', installer.spec, verified, { mode: 'copy', signal }); cancelled(signal);
    const destination = await ensureChildDirectory(workspace, 'installer');
    await runtime.extractor.run(destination, { file: path.join(workspace, 'installer.jar'), sha256: verified.digest, size: verified.size }, { signal }); cancelled(signal);
    const profileBody = await document(path.join(destination, 'install_profile.json'));
    const versionBody = await document(path.join(destination, 'version.json')); cancelled(signal);
    return { workspace, profileBody, versionBody };
  }
}

function sameObject(first: ObjectRef, second: ObjectRef): boolean {
  return first.digest === second.digest && first.size === second.size && first.sourceKey === second.sourceKey;
}
