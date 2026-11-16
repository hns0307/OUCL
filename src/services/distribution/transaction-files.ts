import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, link, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { DistributionTransactionError } from './transaction-record.js';
import type { DirectoryProof, FileProof } from './transaction-record.js';

export interface DistributionMutationContext { root: string; txId: string; rootIdentity: DirectoryProof; leaseToken: string }
export interface AtomicDistributionMutations {
  mutate(operation: 'rename' | 'link' | 'delete' | 'release', context: DistributionMutationContext, source: string, expected: FileProof, destination?: string): Promise<void>;
}
export interface DistributionFileOptions { expectedRoot?: DirectoryProof; mutations?: AtomicDistributionMutations }

function changed(): never { throw new DistributionTransactionError('FILES_CHANGED'); }
export const sameProof = (left: FileProof, right: FileProof): boolean => left.dev === right.dev && left.ino === right.ino && left.sha256 === right.sha256 && left.size === right.size;
/** Guarded private-workspace adapter. No recursive removal is used.
 * Path checks and rename/unlink are not atomic against an uncoordinated external writer;
 * a native identity-bound mutation adapter is required before enabling product execution.
 */
export class DistributionTransactionFiles {
  readonly staging: string;
  readonly lock: string;
  private boundRoot: DirectoryProof | undefined;
  private leaseToken: string | undefined;
  constructor(readonly gameDir: string, private readonly txId: string, private readonly options: DistributionFileOptions = {}) {
    this.staging = path.join(gameDir, '.oucl-distribution-staging', txId);
    this.lock = path.join(gameDir, 'oucl.session.lock');
    this.boundRoot = options.expectedRoot ? { ...options.expectedRoot } : undefined;
  }
  get gameIdentity(): DirectoryProof { if (!this.boundRoot) throw new DistributionTransactionError('NEEDS_RECOVERY'); return { ...this.boundRoot }; }
  /** Bind this transaction to the actual game-directory inode, including across recovery. */
  async bindRoot(): Promise<void> {
    await guardDirectory(this.gameDir); const info = await lstat(this.gameDir, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n) changed();
    const actual = { dev: String(info.dev), ino: String(info.ino) };
    if (this.boundRoot && (actual.dev !== this.boundRoot.dev || actual.ino !== this.boundRoot.ino)) changed();
    this.boundRoot ??= actual;
  }
  private async context(token = this.leaseToken): Promise<DistributionMutationContext> {
    await this.bindRoot(); if (!token) throw new DistributionTransactionError('NEEDS_RECOVERY');
    return { root: this.gameDir, txId: this.txId, rootIdentity: this.gameIdentity, leaseToken: token };
  }
  async directory(directory: string): Promise<void> {
    await this.bindRoot();
    const relative = path.relative(this.gameDir, directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) changed();
    let current = await guardDirectory(this.gameDir);
    for (const component of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      try { await mkdir(current); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
      await guardDirectory(current);
      await this.bindRoot();
    }
  }
  async initialize(): Promise<void> {
    await this.directory(path.dirname(this.staging));
    await mkdir(this.staging); await guardDirectory(this.staging);
  }
  stage(index: number): string { return path.join(this.staging, `${index}.new`); }
  backup(index: number): string { return path.join(this.staging, `${index}.old`); }
  retired(index: number): string { return path.join(this.staging, `${index}.rollback`); }
  /** Missing is distinct from unsafe or replaced; content hashing is bounded and checks the same open inode. */
  async inspect(file: string, maximumLinks = 2): Promise<FileProof | undefined> {
    await this.bindRoot();
    try { await guardDirectory(path.dirname(file)); } catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error; }
    let initial; try { initial = await lstat(file, { bigint: true }); } catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error; }
    if (!initial.isFile() || initial.isSymbolicLink() || initial.ino === 0n || initial.nlink < 1n || initial.nlink > BigInt(maximumLinks) || initial.size > 1024n ** 3n) changed();
    const handle = await open(file, 'r');
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || initial.dev !== before.dev || initial.ino !== before.ino || initial.size !== before.size || initial.ctimeNs !== before.ctimeNs) changed();
      const hash = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); let position = 0;
      while (true) { const read = await handle.read(buffer, 0, buffer.length, position); if (!read.bytesRead) break; position += read.bytesRead; if (position > 1024 ** 3) changed(); hash.update(buffer.subarray(0, read.bytesRead)); }
      const after = await handle.stat({ bigint: true }); const current = await lstat(file, { bigint: true });
      if (position !== Number(initial.size) || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || current.dev !== after.dev || current.ino !== after.ino || current.size !== after.size || current.mtimeNs !== after.mtimeNs || current.ctimeNs !== after.ctimeNs || current.isSymbolicLink()) changed();
      await this.bindRoot(); return { dev: String(after.dev), ino: String(after.ino), size: position, sha256: hash.digest('hex') };
    } finally { await handle.close(); }
  }
  async require(file: string, expected: FileProof): Promise<void> {
    const actual = await this.inspect(file); if (!actual || !sameProof(actual, expected)) changed();
  }
  async copy(source: string, index: number, sha256: string, size: number): Promise<FileProof> {
    const before = await this.inspect(source, 1); if (!before || before.sha256 !== sha256 || before.size !== size) changed();
    await guardDirectory(this.staging); await copyFile(source, this.stage(index), constants.COPYFILE_EXCL);
    const handle = await open(this.stage(index), 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    const result = await this.inspect(this.stage(index), 1); await this.require(source, before);
    if (!result || result.sha256 !== sha256 || result.size !== size) changed(); return result;
  }
  async claim(token: string, recovery: boolean): Promise<void> {
    await this.bindRoot();
    if (recovery && (await readRegular(this.lock, 100))?.toString('utf8') === token) { await this.assertLease(token); return; }
    let handle; try { handle = await open(this.lock, 'wx'); } catch (error) { if (hasCode(error, 'EEXIST')) throw new DistributionTransactionError('INSTANCE_BUSY'); throw error; }
    try { await handle.writeFile(token); await handle.sync(); } finally { await handle.close(); }
    this.leaseToken = token; await this.bindRoot();
  }
  async assertLease(token: string): Promise<void> {
    await this.bindRoot(); const info = await lstat(this.lock);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (await readRegular(this.lock, 100))?.toString('utf8') !== token) throw new DistributionTransactionError('NEEDS_RECOVERY');
    this.leaseToken = token;
  }
  async release(token: string): Promise<void> {
    await this.assertLease(token);
    if (this.options.mutations) {
      const proof = await this.inspect(this.lock, 1); if (!proof) throw new DistributionTransactionError('NEEDS_RECOVERY');
      await this.options.mutations.mutate('release', await this.context(token), this.lock, proof);
    } else await unlink(this.lock);
    this.leaseToken = undefined;
  }
  async moveAside(target: string, retained: string, expected: FileProof): Promise<void> {
    if (this.options.mutations) { await this.options.mutations.mutate('rename', await this.context(), target, expected, retained); await this.require(retained, expected); return; }
    await this.require(target, expected); await guardDirectory(path.dirname(retained));
    if (await this.inspect(retained)) changed();
    await rename(target, retained);
    // If an external actor won between validation and rename, retain its bytes and stop. Never discard them.
    await this.require(retained, expected);
  }
  async publish(source: string, target: string, expected: FileProof): Promise<void> {
    if (this.options.mutations) { await this.options.mutations.mutate('link', await this.context(), source, expected, target); await this.require(target, expected); return; }
    await this.require(source, expected); await guardDirectory(path.dirname(target));
    await link(source, target); await this.require(target, expected);
  }
  async removeOwned(file: string, expected: FileProof): Promise<void> {
    if (this.options.mutations) { await this.options.mutations.mutate('delete', await this.context(), file, expected); return; }
    await this.require(file, expected); await unlink(file);
  }
}
