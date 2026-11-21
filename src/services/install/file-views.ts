import { chmod, lstat, mkdir, open, readlink, realpath, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { installRelativePath } from '../../core/install/assets.js';
import type { ObjectStore, ObjectRef } from '../objects/store.js';
import type { DownloadSpec } from '../download/types.js';
import type { HashPool } from '../workers/hash-pool.js';
import { guardDirectory, hasCode } from '../storage/files.js';

export interface FileViewReceipt { relativePath: string; objectDigest: string; size: number; mode: 'symlink' | 'copy' }
export type ViewCode = 'INVALID_VIEW' | 'VIEW_CONFLICT' | 'NEEDS_RECOVERY' | 'VIEW_IO' | 'CANCELLED';
/** Fixed view failure; existing conflicting entries and shared objects are never overwritten or removed. */
export class FileViewError extends Error {
  readonly category: 'validation' | 'disk' | 'cancelled' | 'biz';
  constructor(readonly code: ViewCode) {
    super(code); this.name = 'FileViewError';
    this.category = code === 'INVALID_VIEW' ? 'validation' : code === 'CANCELLED' ? 'cancelled' : code === 'VIEW_CONFLICT' ? 'biz' : 'disk';
  }
}
interface ViewOptions { mode: 'prefer-link' | 'copy'; signal?: AbortSignal; existing?: FileViewReceipt }
type Link = (target: string, file: string) => Promise<void>;

/** Materializes immutable object projections into ordinary controlled directories.
 * Receipts are internal outputs for the installation operation log, not a new standalone disk schema.
 */
export class FileViewService {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly storeDirectory: string, private readonly objects: Pick<ObjectStore, 'lookup'>,
    private readonly hasher: Pick<HashPool, 'hash'>, private readonly link: Link = async (target, file) => symlink(target, file, 'file')) {}

  /** Creates one new projection, or verifies an explicitly recorded receipt. Unknown entries fail closed. */
  materialize(directory: string, relative: string, spec: DownloadSpec, object: ObjectRef, options: ViewOptions): Promise<FileViewReceipt> {
    const run = this.tail.then(() => this.perform(directory, relative, spec, object, options));
    this.tail = run.then(() => {}, () => {}); return run;
  }

  private async perform(directory: string, relative: string, spec: DownloadSpec, object: ObjectRef, options: ViewOptions): Promise<FileViewReceipt> {
    const cancelled = (): void => { if (options.signal?.aborted) throw new FileViewError('CANCELLED'); };
    try {
      try { installRelativePath(relative); } catch { throw new FileViewError('INVALID_VIEW'); }
      if (!/^[a-f0-9]{64}$/.test(object.digest) || !Number.isSafeInteger(object.size) || object.size < 0
        || options.mode !== 'copy' && options.mode !== 'prefer-link') throw new FileViewError('INVALID_VIEW');
      const root = await guardDirectory(directory); const store = await guardDirectory(this.storeDirectory);
      const source = path.join(store, 'objects', 'sha256', object.digest.slice(0, 2), object.digest);
      cancelled();
      const trusted = await this.objects.lookup(spec.expected, spec.anchor); cancelled();
      if (!trusted || trusted.digest !== object.digest || trusted.size !== object.size || trusted.sourceKey !== object.sourceKey) throw new FileViewError('NEEDS_RECOVERY');
      await guardDirectory(path.dirname(source));
      const parts = relative.split('/'); const name = parts.pop()!; let parent = root;
      for (const part of parts) {
        await guardDirectory(parent); parent = path.join(parent, part);
        try { await mkdir(parent); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
        await guardDirectory(parent); cancelled();
      }
      const target = path.join(parent, name); let old;
      try { old = await lstat(target); } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
      const receipt = options.existing;
      if (receipt && (receipt.relativePath !== relative || receipt.objectDigest !== object.digest || receipt.size !== object.size
        || !['copy', 'symlink'].includes(receipt.mode))) throw new FileViewError('INVALID_VIEW');
      if (old) {
        if (!receipt) throw new FileViewError('VIEW_CONFLICT');
        if (receipt.mode === 'symlink') {
          if (!old.isSymbolicLink() || path.resolve(parent, await readlink(target)) !== source || await realpath(target) !== await realpath(source)) throw new FileViewError('NEEDS_RECOVERY');
        } else {
          if (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1) throw new FileViewError('NEEDS_RECOVERY');
          await this.verify(target, object, options.signal);
        }
        cancelled(); return { ...receipt };
      }
      if (receipt) throw new FileViewError('NEEDS_RECOVERY');
      cancelled(); let mode: FileViewReceipt['mode'] = 'copy';
      if (options.mode === 'prefer-link') {
        try {
          await this.link(source, target);
          const linked = await lstat(target);
          if (!linked.isSymbolicLink() || path.resolve(parent, await readlink(target)) !== source) throw new FileViewError('NEEDS_RECOVERY');
          mode = 'symlink';
        }
        catch (error) {
          if (!['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].some(code => hasCode(error, code))) throw error;
          // Capability fallback never overwrites an entry left by a failed link implementation.
          try { await lstat(target); throw new FileViewError('NEEDS_RECOVERY'); }
          catch (check) { if (!hasCode(check, 'ENOENT')) throw check; }
        }
      }
      if (mode === 'copy') await this.copy(source, target, object, options.signal);
      // Once an entry exists, return its receipt even when cancellation arrives at this commit boundary.
      // The operation owner must journal that receipt before processing cancellation or publishing ready.
      return { relativePath: relative, objectDigest: object.digest, size: object.size, mode };
    } catch (error) {
      if (error instanceof FileViewError) throw error;
      throw new FileViewError(hasCode(error, 'CANCELLED') ? 'CANCELLED' : hasCode(error, 'UNSAFE_PATH') || hasCode(error, 'NEEDS_RECOVERY') || hasCode(error, 'HASH_MISMATCH') ? 'NEEDS_RECOVERY'
        : hasCode(error, 'EEXIST') ? 'VIEW_CONFLICT' : 'VIEW_IO');
    }
  }

  private async verify(file: string, object: ObjectRef, signal?: AbortSignal): Promise<void> {
    const result = await this.hasher.hash(file, { maximumBytes: object.size, ...(signal ? { signal } : {}) });
    if (result.sha256 !== object.digest || result.size !== object.size) throw new FileViewError('NEEDS_RECOVERY');
  }
  private async copy(source: string, target: string, object: ObjectRef, signal?: AbortSignal): Promise<void> {
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== object.size) throw new FileViewError('NEEDS_RECOVERY');
    const input = await open(source, 'r'); let output; let created = false;
    try {
      const opened = await input.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== object.size) throw new FileViewError('NEEDS_RECOVERY');
      output = await open(target, 'wx'); created = true;
      const block = Buffer.alloc(256 * 1024); let position = 0;
      while (position < object.size) {
        if (signal?.aborted) throw new FileViewError('CANCELLED');
        const { bytesRead } = await input.read(block, 0, Math.min(block.length, object.size - position), position);
        if (!bytesRead) throw new FileViewError('NEEDS_RECOVERY');
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(block, written, bytesRead - written, position + written);
          if (!result.bytesWritten) throw new FileViewError('VIEW_IO'); written += result.bytesWritten;
        }
        position += bytesRead;
      }
      await output.sync(); await output.close(); output = undefined;
      await this.verify(target, object, signal); await chmod(target, 0o444); created = false;
    } finally {
      await output?.close(); await input.close();
      if (created) await unlink(target); // Only the newly wx-created regular entry; never a shared target.
    }
  }
}
