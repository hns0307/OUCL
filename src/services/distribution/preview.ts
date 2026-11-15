import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { DistributionError, distributionDiff, parseDistributionManifest } from '../../core/distribution/manifest.js';
import type { DistributionArea, DistributionDiff, DistributionManifest, DistributionObservation } from '../../core/distribution/manifest.js';
import { parsePackageReceipt, projectDistributionOwnership } from '../../core/distribution/ownership.js';
import type { OwnershipRow, PackageReceipt, UserAddedEvidence } from '../../core/distribution/ownership.js';
import { installRelativePath } from '../../core/install/assets.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { PinnedDistributionSource } from './source.js';
import type { TrustedDistributionSource } from './source.js';

export type DistributionPreviewCode = 'SOURCE_UNAVAILABLE' | 'UNTRUSTED_DISTRIBUTION' | 'INVALID_MANIFEST' | 'INVALID_REQUEST' | 'TARGET_MISMATCH' | 'FILES_CHANGED' | 'UNSAFE_FILES' | 'PREVIEW_LIMIT' | 'PREVIEW_BUSY' | 'CANCELLED';
export class DistributionPreviewError extends Error {
  constructor(readonly code: DistributionPreviewCode) { super(code); this.name = 'DistributionPreviewError'; }
}
export interface DistributionTarget {
  instanceId: string; revision: number; gameDir: string; environment: DistributionManifest['target'];
  userAdded?: readonly UserAddedEvidence[];
}
export interface DistributionPreviewRequest { sourceId: string; packageId: string; packageVersion: string; instanceId: string }
export interface DistributionPreview {
  sourceId: string; instanceId: string; revision: number; manifest: DistributionManifest; diff: DistributionDiff;
  ownership: OwnershipRow[]; receiptStatus: 'missing' | 'valid'; readOnly: true;
}
export interface DistributionPreviewOptions {
  sources: readonly TrustedDistributionSource[];
  readTarget(instanceId: string, signal?: AbortSignal): Promise<DistributionTarget>;
  fetcher?: typeof fetch;
}
const RECEIPT_NAME = '.oucl-distribution-receipts.json';
const sameStamp = (left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }, right: typeof left): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;

/** Fixed optional receipt reader. Unknown/corrupt receipts stop the preview; absent receipts never adopt old files. */
export async function readPackageReceipt(gameDir: string, instanceId: string): Promise<PackageReceipt | undefined> {
  await guardDirectory(gameDir);
  const bytes = await readRegular(path.join(gameDir, RECEIPT_NAME), 1024 * 1024);
  return bytes === undefined ? undefined : parsePackageReceipt(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, instanceId);
}

/** Bounded real-file observation. Rejects linked ancestors and files; handles and before/after stamps detect replacement. */
export async function observeDistributionFiles(gameDir: string, signal?: AbortSignal): Promise<DistributionObservation[]> {
  const deadline = Date.now() + 15000; let bytesRead = 0; let entries = 0;
  const check = (): void => {
    if (signal?.aborted) throw new DistributionPreviewError('CANCELLED');
    if (Date.now() >= deadline || bytesRead > 256 * 1024 ** 2 || entries > 4096) throw new DistributionPreviewError('PREVIEW_LIMIT');
  };
  const canonical = await guardDirectory(gameDir); const files: DistributionObservation[] = [];
  const stamps: Array<{ target: string; info: Stats }> = [];
  async function visit(area: DistributionArea, relative: string, depth: number): Promise<void> {
    check(); if (depth > 16) throw new DistributionPreviewError('PREVIEW_LIMIT');
    const directory = path.join(canonical, area, relative);
    try { await guardDirectory(directory); } catch (error) { if (hasCode(error, 'ENOENT') && !relative) return; throw error; }
    const before = await lstat(directory);
    for await (const entry of await opendir(directory)) {
      entries++; check(); const name = relative ? `${relative}/${entry.name}` : entry.name; installRelativePath(name);
      const target = path.join(canonical, area, name); const info = await lstat(target);
      if (info.isSymbolicLink()) throw new DistributionPreviewError('UNSAFE_FILES');
      if (info.isDirectory()) { await visit(area, name, depth + 1); continue; }
      if (!info.isFile() || info.nlink !== 1) throw new DistributionPreviewError('UNSAFE_FILES');
      if (info.size > 256 * 1024 ** 2 - bytesRead) throw new DistributionPreviewError('PREVIEW_LIMIT');
      await guardDirectory(directory);
      const handle = await open(target, 'r'); const hash = createHash('sha256');
      try {
        const opened = await handle.stat(); if (!opened.isFile() || opened.nlink !== 1 || !sameStamp(info, opened)) throw new DistributionPreviewError('FILES_CHANGED');
        const chunk = Buffer.alloc(64 * 1024); let position = 0;
        while (true) {
          check(); const read = await handle.read(chunk, 0, chunk.length, position); if (!read.bytesRead) break;
          position += read.bytesRead; bytesRead += read.bytesRead; check(); hash.update(chunk.subarray(0, read.bytesRead));
        }
        if (position !== info.size || !sameStamp(info, await handle.stat()) || !sameStamp(info, await lstat(target))) throw new DistributionPreviewError('FILES_CHANGED');
      } finally { await handle.close(); }
      await guardDirectory(directory); stamps.push({ target, info }); files.push({ area, path: name, sha256: hash.digest('hex'), managedId: null });
    }
    if (!sameStamp(before, await lstat(directory))) throw new DistributionPreviewError('FILES_CHANGED');
  }
  try {
    for (const area of ['mods', 'resourcepacks', 'config'] as const) await visit(area, '', 0);
    for (const stamp of stamps) {
      check(); await guardDirectory(path.dirname(stamp.target)); const current = await lstat(stamp.target);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || !sameStamp(stamp.info, current)) throw new DistributionPreviewError('FILES_CHANGED');
    }
    check(); return files.sort((a, b) => `${a.area}/${a.path}`.localeCompare(`${b.area}/${b.path}`, 'en'));
  } catch (error) {
    if (error instanceof DistributionPreviewError) throw error;
    throw new DistributionPreviewError('UNSAFE_FILES');
  }
}

/** Main-owned target resolver supplies paths and environment; renderer requests contain only fixed identities. No writes or execution. */
export class DistributionPreviewService {
  private readonly sources: readonly TrustedDistributionSource[];
  private active = false;
  constructor(private readonly options: DistributionPreviewOptions) { this.sources = structuredClone(options.sources); }
  listSources(): Array<{ sourceId: string }> { return this.sources.map(source => ({ sourceId: source.sourceId })); }
  async preview(request: DistributionPreviewRequest, signal?: AbortSignal): Promise<DistributionPreview> {
    if (signal?.aborted) throw new DistributionPreviewError('CANCELLED');
    if (!UUID_PATTERN.test(request.instanceId) || ![request.sourceId, request.packageId, request.packageVersion].every(value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value))) throw new DistributionPreviewError('INVALID_REQUEST');
    const source = this.sources.find(entry => entry.sourceId === request.sourceId);
    if (!source) throw new DistributionPreviewError('SOURCE_UNAVAILABLE');
    if (this.active) throw new DistributionPreviewError('PREVIEW_BUSY'); this.active = true;
    try {
      const envelope = await new PinnedDistributionSource(source, this.options.fetcher).resolve(request, signal);
      const target = await this.options.readTarget(request.instanceId.toLowerCase(), signal);
      if (target.instanceId !== request.instanceId.toLowerCase() || !Number.isSafeInteger(target.revision) || target.revision < 1
        || JSON.stringify(parseDistributionManifest({ ...envelope.payload, target: target.environment }).target) !== JSON.stringify(envelope.payload.target)) throw new DistributionPreviewError('TARGET_MISMATCH');
      const receipt = await readPackageReceipt(target.gameDir, target.instanceId);
      const files = await observeDistributionFiles(target.gameDir, signal);
      const latest = await this.options.readTarget(target.instanceId, signal);
      if (JSON.stringify(latest) !== JSON.stringify(target)) throw new DistributionPreviewError('FILES_CHANGED');
      const receiptAfter = await readPackageReceipt(target.gameDir, target.instanceId);
      if (JSON.stringify(receiptAfter) !== JSON.stringify(receipt)) throw new DistributionPreviewError('FILES_CHANGED');
      const ownership = projectDistributionOwnership(files, receipt, request, target.userAdded);
      const diff = distributionDiff(envelope.payload, ownership);
      // Config edits, another package's claims and user overrides are conservative conflicts even with forged expected hashes.
      for (const operation of envelope.payload.operations) {
        const current = ownership.find(file => file.area === operation.area && file.path.toLowerCase() === operation.path.toLowerCase());
        if (operation.kind !== 'keep' && current && (current.ownership === 'ownership-conflict' || current.ownership === 'user-overridden'
          || operation.area === 'config' && operation.kind !== 'add')) {
          if (!diff.conflicts.some(conflict => conflict.area === operation.area && conflict.path === operation.path)) diff.conflicts.push({ area: operation.area, path: operation.path, code: 'CHANGED' });
        }
      }
      if (diff.conflicts.length) diff.changes = [];
      if (signal?.aborted) throw new DistributionPreviewError('CANCELLED');
      return { sourceId: request.sourceId, instanceId: target.instanceId, revision: target.revision, manifest: envelope.payload, diff, ownership,
        receiptStatus: receipt ? 'valid' : 'missing', readOnly: true };
    } catch (error) {
      if (error instanceof DistributionPreviewError) throw error;
      if (error instanceof DistributionError) throw new DistributionPreviewError(error.code);
      if (signal?.aborted) throw new DistributionPreviewError('CANCELLED');
      throw new DistributionPreviewError('UNSAFE_FILES');
    } finally { this.active = false; }
  }
}
