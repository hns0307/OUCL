import path from 'node:path';
import type { StorageClient } from '../workers/storage-client.js';
import { restoreInstallMetadata } from '../install/installer.js';
import { instanceGameLayout } from '../install/instance-files.js';
import { ModInventoryError } from './inventory.js';
import type { ModInventoryContext } from './inventory.js';
import type { InstalledLanguageReader } from './languages.js';
import type { InstalledJavaFacts } from './java-facts.js';

/** Resolves only the current registered root and ready instance; directory names never come from IPC. */
export function modInventoryContext(storage: Pick<StorageClient, 'readInstallation' | 'readInstance'>,
  languages?: Pick<InstalledLanguageReader, 'read'>, java?: Pick<InstalledJavaFacts, 'read'>): (instanceId: string, signal?: AbortSignal) => Promise<ModInventoryContext> {
  return async (instanceId, signal) => {
    const root = await storage.readInstallation(); const record = await storage.readInstance(instanceId);
    if (!root || !record || record.data.summary.rootId !== root.data.rootId || record.data.phase !== 'ready') throw new ModInventoryError('INVALID_ARGUMENT');
    const prepared = restoreInstallMetadata(record.data);
    const layout = instanceGameLayout(root.data.dataDirectory, record.data.summary, prepared);
    const loader = record.data.loader ?? { kind: 'vanilla' as const };
    const versions: Record<string, string | null> = { minecraft: record.data.summary.mcVersionId, java: null };
    if (loader.kind !== 'vanilla') versions[{ fabric: 'fabricloader', quilt: 'quilt_loader', forge: 'forge', neoforge: 'neoforge' }[loader.kind]] = loader.version;
    const languageVersions = languages ? await languages.read(root.data.dataDirectory, record.data, signal) : {};
    if (java) versions.java = await java.read(prepared.version.javaMajor, signal);
    return { instanceId, revision: record.revision, modsDirectory: path.join(layout.gameDirectory, 'mods'),
      environment: { loader: loader.kind, versions, languageVersions } };
  };
}
