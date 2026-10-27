import type { LoaderMetadataClient } from './metadata.js';
import type { InstallerService, CreateLoaderInstanceInput } from '../install/installer.js';
import { CatalogError } from '../catalog/transport.js';
import { InstallerError } from '../install/installer.js';
import { LoaderContractError } from '../../shared/contracts/loaders.js';
import type { LoaderData, LoaderDispatcher, LoaderPayloads } from '../../shared/contracts/loaders.js';
import { WorkerError } from '../workers/protocol.js';

function mapped(error: unknown): LoaderContractError {
  if (error instanceof WorkerError) return new LoaderContractError(error.code === 'REVISION_CONFLICT' ? 'REVISION_CONFLICT'
    : error.code === 'NEEDS_RECOVERY' || error.code === 'INVALID_RECORD' ? 'NEEDS_RECOVERY' : error.code === 'INVALID_MESSAGE' ? 'INVALID_ARGUMENT' : 'UNAVAILABLE');
  if (error instanceof CatalogError) return new LoaderContractError(error.code === 'INVALID_ARGUMENT' ? 'INVALID_ARGUMENT'
    : error.code === 'UNTRUSTED_MANIFEST' ? 'UNTRUSTED_METADATA' : 'NETWORK_FAILED');
  if (error instanceof InstallerError) return new LoaderContractError(error.code === 'ROOT_UNAVAILABLE' || error.code === 'NAME_CONFLICT'
    || error.code === 'NEEDS_RECOVERY' ? error.code : 'INSTALL_FAILED');
  return new LoaderContractError('UNAVAILABLE');
}

function requireMatrix(input: LoaderPayloads['loaders:versions']): void {
  if (input.loader === 'forge' && input.minecraftVersion !== '1.20.1'
    || input.loader === 'neoforge' && input.minecraftVersion !== '1.21.1') throw new LoaderContractError('VERSION_UNSUPPORTED');
}

/** Revalidates the selected official identity before admitting the common installation transaction. */
export class LoaderService {
  private readonly pending = new Map<string, Promise<{ taskId: string }>>();
  constructor(private readonly metadata: Pick<LoaderMetadataClient, 'catalog'>,
    private readonly installer: Pick<InstallerService, 'createLoader' | 'findAcceptedLoader'>) {}

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
    requireMatrix(input);
    const catalog = await this.metadata.catalog(input.loader, input.minecraftVersion);
    return { items: catalog.items.map(item => ({ loaderVersion: item.loaderVersion, stable: item.stable, support: 'unverified' })) };
  }

  private create(requestId: string, input: LoaderPayloads['loaders:create']): Promise<LoaderData['loaders:create']> {
    requireMatrix(input);
    if (input.isolation !== 'on') throw new LoaderContractError('INVALID_ARGUMENT');
    const canonical = { rootId: input.rootId.toLowerCase(), mcVersionId: input.minecraftVersion, displayName: input.displayName,
      isolation: input.isolation, loader: { kind: input.loader, version: input.loaderVersion } };
    const key = `${requestId.toLowerCase()}:${JSON.stringify(canonical)}`; const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 16) throw new LoaderContractError('UNAVAILABLE');
    const operation = this.admitCreate(requestId, canonical); this.pending.set(key, operation);
    void operation.finally(() => { this.pending.delete(key); }).catch(() => {});
    return operation;
  }
  private async admitCreate(requestId: string, canonical: CreateLoaderInstanceInput): Promise<{ taskId: string }> {
    const accepted = await this.installer.findAcceptedLoader(requestId, canonical);
    if (accepted) return accepted;
    const catalog = await this.metadata.catalog(canonical.loader.kind, canonical.mcVersionId);
    if (!catalog.items.some(item => item.kind === canonical.loader.kind && item.minecraftVersion === canonical.mcVersionId
      && item.loaderVersion === canonical.loader.version)) throw new LoaderContractError('VERSION_UNSUPPORTED');
    return this.installer.createLoader(requestId, canonical);
  }
}
