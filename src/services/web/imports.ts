import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { WEB_ERRORS } from '../../shared/contracts/web-extensions.js';
import type { WebErrorCode } from '../../shared/contracts/web-extensions.js';
import { ensureChildDirectory, instanceGameLayout } from '../install/instance-files.js';
import { restoreInstallMetadata } from '../install/installer.js';
import { ModrinthModClient } from '../mods/modrinth.js';
import type { ResourceService } from '../resources/service.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { WebFileProof } from './classify.js';
import { MAX_INSPECT_BYTES } from './classify.js';
import { WebError } from './errors.js';

export type WebImportStorage = Pick<StorageClient, 'readInstallation' | 'readInstance' | 'readGameSessions'>;
export interface WebImportOptions {
  storage?: WebImportStorage;
  resources?: Pick<ResourceService, 'download'>;
  transport?: typeof fetch;
  installPack?: (source: WebImportFile, name: string, authorize: () => boolean) => Promise<{ taskId: string }>;
}
export interface WebImportFile { file: string; filename: string; proof: WebFileProof }

async function fileChecked(file: string, proof: WebFileProof): Promise<void> {
  await guardDirectory(path.dirname(file));
  const bytes = await readRegular(file, MAX_INSPECT_BYTES);
  if (!bytes || bytes.length !== proof.size || createHash('sha256').update(bytes).digest('hex') !== proof.sha256) throw new WebError('UNAVAILABLE');
}

async function directorySignature(directory: string): Promise<string> {
  await guardDirectory(directory);
  const record = await lstat(directory, { bigint: true });
  if (!record.isDirectory() || record.isSymbolicLink() || !record.ino) throw new WebError('UNAVAILABLE');
  return `${record.dev}:${record.ino}`;
}

async function releaseAddonLease(directory: string, identity: string, lock: string, token: string, temporary?: string): Promise<void> {
  if (await directorySignature(directory) !== identity || (await readRegular(lock, 100))?.toString('utf8') !== token) {
    throw new WebError('UNAVAILABLE');
  }
  if (temporary) {
    await guardDirectory(path.dirname(temporary));
    await unlink(temporary).catch(() => {});
  }
  await unlink(lock);
}

/** A browser file only becomes a native operation through an approved, digest-bound import path. */
export class WebImports {
  private readonly platform: ModrinthModClient;
  constructor(private readonly options: WebImportOptions) {
    this.platform = new ModrinthModClient(options.transport);
  }

  get hasPackImport(): boolean { return this.options.installPack !== undefined; }

  async installPack(source: WebImportFile, name: string, authorize: () => boolean): Promise<{ taskId: string }> {
    if (!this.options.installPack || source.proof.kind !== 'modpack') throw new WebError('UNSUPPORTED_IMPORT');
    await fileChecked(source.file, source.proof);
    if (!authorize()) throw new WebError('INVALID_SENDER');
    return this.options.installPack(source, name, authorize);
  }

  /** Delegates Java archives to authoritative Modrinth metadata and the ordinary OUCL resource plan. */
  async prepareMod(source: WebImportFile, authorize: () => boolean): Promise<void> {
    const resources = this.options.resources;
    if (!resources || source.proof.kind !== 'mod') throw new WebError('UNSUPPORTED_IMPORT');
    await fileChecked(source.file, source.proof);
    const { sha512, size, sha1 } = source.proof;
    const version = (await this.platform.byHashes([sha512])).get(sha512);
    const verified = version?.files.find(file => file.sha512 === sha512 && file.sha1 === sha1 && file.size === size);
    if (!version || !verified || !verified.filename.toLowerCase().endsWith('.jar')) throw new WebError('UNSUPPORTED_IMPORT');
    if (!authorize()) throw new WebError('INVALID_SENDER');
    await resources.download(randomUUID(), { projectId: version.projectId, versionId: version.versionId, fileId: sha1 });
  }

  /** Publishes an add-only client zip under the usual game-directory lease. */
  async installAddon(source: WebImportFile, instanceId: string, expectedRevision: number, authorize: () => boolean): Promise<void> {
    const storage = this.options.storage;
    const kind = source.proof.kind;
    if (!storage || kind !== 'shader' && kind !== 'resourcepack') throw new WebError('UNSUPPORTED_IMPORT');
    const root = await storage.readInstallation();
    const record = await storage.readInstance(instanceId);
    if (!root || !record || record.revision !== expectedRevision || record.data.phase !== 'ready'
      || record.data.summary.rootId !== root.data.rootId || record.data.summary.isolation === 'off') throw new WebError('INSTANCE_CHANGED');
    const directory = instanceGameLayout(root.data.dataDirectory, record.data.summary, restoreInstallMetadata(record.data)).gameDirectory;
    const identity = await directorySignature(directory);
    if (!authorize()) throw new WebError('INVALID_SENDER');
    const lock = path.join(directory, 'oucl.session.lock');
    const token = randomUUID();
    let handle;
    try { handle = await open(lock, 'wx', 0o600); }
    catch (error) { throw new WebError(hasCode(error, 'EEXIST') ? 'INSTANCE_BUSY' : 'UNAVAILABLE'); }
    let temporary: string | undefined;
    try {
      try { await handle.writeFile(token); await handle.sync(); } finally { await handle.close(); }
      const target = await ensureChildDirectory(directory, kind === 'shader' ? 'shaderpacks' : 'resourcepacks');
      const targetIdentity = await directorySignature(target);
      const staging = await ensureChildDirectory(directory, '.oucl-web-staging');
      await fileChecked(source.file, source.proof);
      temporary = path.join(staging, `${randomUUID()}.zip`);
      await copyFile(source.file, temporary, constants.COPYFILE_EXCL);
      await fileChecked(temporary, source.proof);
      const [liveRoot, liveInstance, liveSessions] = await Promise.all([storage.readInstallation(), storage.readInstance(instanceId), storage.readGameSessions()]);
      if (liveRoot?.data.rootId !== root.data.rootId || liveRoot.data.dataDirectory !== root.data.dataDirectory
        || liveInstance?.revision !== expectedRevision || liveInstance.data.phase !== 'ready') throw new WebError('INSTANCE_CHANGED');
      if (liveSessions?.data.items.some(item => item.rootId === root.data.rootId && item.snapshot.instanceId === instanceId
        && item.snapshot.state !== 'exited')) throw new WebError('INSTANCE_BUSY');
      if (await directorySignature(directory) !== identity || await directorySignature(target) !== targetIdentity
        || (await readRegular(lock, 100))?.toString('utf8') !== token) throw new WebError('UNAVAILABLE');
      if (!authorize()) throw new WebError('INVALID_SENDER');
      try { await link(temporary, path.join(target, source.filename)); }
      catch (error) { throw new WebError(hasCode(error, 'EEXIST') ? 'FILE_EXISTS' : 'UNAVAILABLE'); }
    } finally { await releaseAddonLease(directory, identity, lock, token, temporary); }
  }
}

export function mapWebImportFailure(error: unknown): WebError {
  if (error instanceof WebError) return error;
  if (typeof error === 'object' && error !== null && 'code' in error && WEB_ERRORS.includes(error.code as WebErrorCode)) {
    return new WebError(error.code as WebErrorCode);
  }
  return new WebError('UNAVAILABLE');
}
