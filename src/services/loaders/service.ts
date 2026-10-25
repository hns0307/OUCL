import type { LoaderMetadataClient } from './metadata.js';
import type { InstallerService } from '../install/installer.js';
import { CatalogError } from '../catalog/transport.js';
import { InstallerError } from '../install/installer.js';
import { LoaderContractError } from '../../shared/contracts/loaders.js';
import type { LoaderData, LoaderDispatcher, LoaderPayloads } from '../../shared/contracts/loaders.js';

function mapped(error: unknown): LoaderContractError {
  if (error instanceof CatalogError) return new LoaderContractError(error.code === 'INVALID_ARGUMENT' ? 'INVALID_ARGUMENT'
    : error.code === 'UNTRUSTED_MANIFEST' ? 'UNTRUSTED_METADATA' : 'NETWORK_FAILED');
  if (error instanceof InstallerError) return new LoaderContractError(error.code === 'ROOT_UNAVAILABLE' || error.code === 'NAME_CONFLICT'
    || error.code === 'NEEDS_RECOVERY' ? error.code : 'INSTALL_FAILED');
  return new LoaderContractError('UNAVAILABLE');
}

/** Public Fabric/Quilt adapter. Forge families remain explicit unsupported results until their processors exist. */
export class LoaderService {
  constructor(private readonly metadata: Pick<LoaderMetadataClient, 'catalog'>,
    private readonly installer: Pick<InstallerService, 'createLoader'>) {}

  dispatcher(): LoaderDispatcher {
    return async (channel, payload, requestId) => {
      try {
        if (channel === 'loaders:versions') return await this.versions(payload as LoaderPayloads['loaders:versions']) as LoaderData[typeof channel];
        if (channel === 'loaders:create') return await this.create(requestId, payload as LoaderPayloads['loaders:create']) as LoaderData[typeof channel];
        throw new LoaderContractError('INVALID_ARGUMENT');
      } catch (error) { throw error instanceof LoaderContractError ? error : mapped(error); }
    };
  }

  private async versions(input: LoaderPayloads['loaders:versions']): Promise<LoaderData['loaders:versions']> {
    if (input.loader === 'forge' || input.loader === 'neoforge') throw new LoaderContractError('VERSION_UNSUPPORTED');
    const catalog = await this.metadata.catalog(input.loader, input.minecraftVersion);
    return { items: catalog.items.map(item => ({ loaderVersion: item.loaderVersion, stable: item.stable, support: 'unverified' })) };
  }

  private async create(requestId: string, input: LoaderPayloads['loaders:create']): Promise<LoaderData['loaders:create']> {
    if (input.loader === 'forge' || input.loader === 'neoforge') throw new LoaderContractError('VERSION_UNSUPPORTED');
    const catalog = await this.metadata.catalog(input.loader, input.minecraftVersion);
    if (!catalog.items.some(item => item.loaderVersion === input.loaderVersion)) throw new LoaderContractError('VERSION_UNSUPPORTED');
    return this.installer.createLoader(requestId, { rootId: input.rootId, mcVersionId: input.minecraftVersion, displayName: input.displayName,
      isolation: input.isolation, loader: { kind: input.loader, version: input.loaderVersion } });
  }
}
