import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { isResourcePayload } from '../../shared/contracts/resources.js';
import type { ResourcePayloads } from '../../shared/contracts/resources.js';
import { ModContractError } from '../../shared/contracts/mods.js';
import type { PlatformModVersion } from '../../core/mods/platform.js';
import { sourceKey } from '../objects/provenance.js';
import type { ResourceRecord } from '../storage/resources.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { ModArchiveReader } from '../workers/mod-archive-reader.js';
import { ModArchiveError } from './archive.js';
import type { ModArchiveScan } from './archive.js';
import type { ModrinthModClient } from './modrinth.js';

export interface ModLibraryRoot { record: ResourceRecord; scan: ModArchiveScan; version: PlatformModVersion }
type Selection = ResourcePayloads['resources:download'];
async function stamp(file: string): Promise<string> {
  const value = await lstat(file);
  if (!value.isFile() || value.isSymbolicLink()) throw new ModContractError('MODS_UNSAFE');
  return JSON.stringify([value.size, value.dev, value.ino, value.mtimeMs, value.ctimeMs]);
}

/** Rechecks an already downloaded library JAR against actual bytes and exact current platform evidence. Never installs. */
export class ModLibraryReader {
  private active = false;
  constructor(private readonly storage: Pick<StorageClient, 'readInstallation' | 'readResources'>,
    private readonly scanner: Pick<ModArchiveReader, 'read'>, private readonly platform: Pick<ModrinthModClient, 'version'>) {}
  async read(input: Selection, signal?: AbortSignal): Promise<ModLibraryRoot> {
    if (!isResourcePayload(input, 'resources:download')) throw new ModContractError('INVALID_ARGUMENT');
    if (this.active) throw new ModContractError('SCAN_BUSY');
    this.active = true;
    const selection = { ...input }; const check = (): void => { if (signal?.aborted) throw new ModContractError('CANCELLED'); };
    try {
      check(); const root = await this.storage.readInstallation(); check();
      if (!root) throw new ModContractError('ROOT_UNAVAILABLE');
      const resources = await this.storage.readResources(); check();
      if (resources && resources.data.rootId !== root.data.rootId) throw new ModContractError('NEEDS_RECOVERY');
      const matches = resources?.data.items.filter(item => item.projectId === selection.projectId && item.versionId === selection.versionId
        && item.fileId === selection.fileId && item.downloaded) ?? [];
      if (!matches.length) throw new ModContractError('NOT_FOUND');
      const record = structuredClone(matches[0]!);
      if (record.kind !== 'mod' || !record.filename.toLowerCase().endsWith('.jar') || !record.object) throw new ModContractError('INVALID_ARGUMENT');
      if (matches.some(item => item.object?.digest !== record.object!.digest || item.filename !== record.filename)
        || record.object.sourceKey !== sourceKey(record.spec.expected, record.spec.anchor)) throw new ModContractError('UNTRUSTED_METADATA');
      const file = path.join(root.data.dataDirectory, 'store/objects/sha256', record.object.digest.slice(0, 2), record.object.digest);
      const before = await stamp(file); check(); const scan = await this.scanner.read(file, signal); check();
      if (scan.size !== record.size || scan.size !== record.object.size || scan.sha1 !== record.fileId
        || scan.sha1 !== record.spec.expected.digest || scan.sha256 !== record.object.digest) throw new ModContractError('UNTRUSTED_METADATA');
      const version = await this.platform.version(record.versionId, signal); check();
      const files = version.files.filter(item => item.sha1 === record.fileId && item.filename === record.filename);
      if (version.versionId !== record.versionId || version.projectId !== record.projectId || files.length !== 1
        || files[0]!.size !== scan.size || files[0]!.sha512 !== scan.sha512) throw new ModContractError('UNTRUSTED_METADATA');
      const latestRoot = await this.storage.readInstallation(); check(); const latest = await this.storage.readResources(); check();
      if (JSON.stringify(root.data) !== JSON.stringify(latestRoot?.data) || latest?.data.rootId !== root.data.rootId
        || JSON.stringify(latest.data.items.find(item => item.taskId === record.taskId)) !== JSON.stringify(record)
        || await stamp(file) !== before) throw new ModContractError('FILES_CHANGED');
      return { record, scan, version };
    } catch (error) {
      if (signal?.aborted) throw new ModContractError('CANCELLED');
      if (error instanceof ModArchiveError) throw new ModContractError(error.code === 'ARCHIVE_LIMIT' ? 'MOD_LIMIT'
        : ['INVALID_ARCHIVE', 'UNSAFE_ARCHIVE'].includes(error.code) ? 'MODS_UNSAFE' : 'SCAN_FAILED');
      if (error instanceof ModContractError || typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && ['NETWORK_FAILED', 'UNTRUSTED_METADATA', 'RETRY_LATER', 'NOT_FOUND', 'PLATFORM_LIMIT'].includes(error.code)) throw error;
      throw new ModContractError('SCAN_FAILED');
    } finally { this.active = false; }
  }
}
