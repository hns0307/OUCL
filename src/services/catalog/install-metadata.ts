import { createHash } from 'node:crypto';
import { parseAssetIndex } from '../../core/install/assets.js';
import { planVanillaInstall } from '../../core/install/plan.js';
import type { ResolvedClientVersion, VersionEnvironment } from '../../core/version/types.js';
import type { CatalogService } from './service.js';
import { CatalogError } from './transport.js';
import type { MetadataReader } from './transport.js';

export interface PreparedInstallMetadata {
  version: ResolvedClientVersion;
  assets: ReturnType<typeof parseAssetIndex>;
  plan: ReturnType<typeof planVanillaInstall>;
  metadataSha1ByVersion: Record<string, string>;
  assetIndexBody: string;
}

/** Combines the verified descriptor graph and asset index without downloading executable game content. */
export class InstallMetadataService {
  constructor(private readonly catalog: Pick<CatalogService, 'resolve'>, private readonly reader: MetadataReader) {}

  /** Validates asset-index bytes against their actual declaring descriptor before planning every artifact. */
  async prepare(id: string, environment: VersionEnvironment): Promise<PreparedInstallMetadata> {
    if (environment.os !== 'windows' || environment.arch !== 'x64') throw new CatalogError('INVALID_ARGUMENT');
    try {
      const resolved = await this.catalog.resolve(id, environment);
      const index = resolved.version.assetIndex;
      if (!index || !resolved.version.assetIndexVersionId) throw new CatalogError('UNTRUSTED_MANIFEST');
      const document = await this.reader.read(index.url, index.sha1);
      if (document.sha1 !== index.sha1 || Buffer.byteLength(document.body) !== index.size
        || createHash('sha1').update(document.body).digest('hex') !== index.sha1) throw new CatalogError('UNTRUSTED_MANIFEST');
      const assets = parseAssetIndex(JSON.parse(document.body) as unknown);
      const plan = planVanillaInstall(resolved.version, resolved.metadataSha1ByVersion, assets);
      return { version: resolved.version, assets, plan, metadataSha1ByVersion: resolved.metadataSha1ByVersion, assetIndexBody: document.body };
    } catch (error) {
      throw error instanceof CatalogError ? error : new CatalogError('UNTRUSTED_MANIFEST');
    }
  }
}
