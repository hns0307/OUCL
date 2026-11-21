import { createHash } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { validateComponent } from '../../core/path/layout.js';
import { checkLocalMods } from '../../core/mods/check.js';
import type { LocalModCheck, LocalModFile, ModEnvironment } from '../../core/mods/check.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { guardDirectory, hasCode } from '../storage/files.js';
import { ModArchiveError } from './archive.js';
import type { ModArchiveReader } from '../workers/mod-archive-reader.js';
import { archiveFacts } from './facts.js';

export interface ModInventoryContext { instanceId: string; revision: number; modsDirectory: string; environment: ModEnvironment }
export interface ModInventoryItem extends LocalModFile {
  filename: string; size: number | null; sha1: string | null; sha256: string | null; sha512: string | null;
}
export interface ModInventory { instanceId: string; revision: number; fingerprint: string; items: ModInventoryItem[]; local: LocalModCheck }
export type ModInventoryCode = 'INVALID_ARGUMENT' | 'REVISION_CONFLICT' | 'FILES_CHANGED' | 'MOD_LIMIT' | 'MODS_UNSAFE'
  | 'SCAN_BUSY' | 'CANCELLED' | 'SCAN_FAILED';
export class ModInventoryError extends Error {
  readonly category: 'validation' | 'biz' | 'cancelled' | 'disk';
  constructor(readonly code: ModInventoryCode) {
    super(code); this.name = 'ModInventoryError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'INVALID_ARGUMENT' ? 'validation'
      : code === 'MODS_UNSAFE' || code === 'SCAN_FAILED' ? 'disk' : 'biz';
  }
}
interface FileStamp { size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number; regular: boolean }
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Same content observation identity for actual and prospective directory inventories. */
export function modInventoryFingerprint(instanceId: string, revision: number, items: readonly ModInventoryItem[]): string {
  return digest({ instanceId, revision, items: [...items].sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0)
    .map(item => ({ fileId: item.fileId, filename: item.filename, enabled: item.enabled, size: item.size, sha256: item.sha256, issues: item.issues })) });
}
async function stamp(file: string): Promise<FileStamp> {
  const info = await lstat(file);
  return { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino, dev: info.dev,
    regular: info.isFile() && !info.isSymbolicLink() };
}

/** Reads a single instance at a time. The resolver is main-process-owned and never accepts a renderer path. */
export class ModInventoryService {
  private active = false;
  constructor(private readonly context: (instanceId: string, signal?: AbortSignal) => Promise<ModInventoryContext>, private readonly scanner: Pick<ModArchiveReader, 'read'>) {}

  /** A stable observation, not an installation authorization; commit must independently rehash every planned file. */
  async scan(instanceId: string, expectedRevision: number, signal?: AbortSignal): Promise<ModInventory> {
    if (!UUID_PATTERN.test(instanceId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ModInventoryError('INVALID_ARGUMENT');
    if (this.active) throw new ModInventoryError('SCAN_BUSY'); this.active = true;
    const check = (): void => { if (signal?.aborted) throw new ModInventoryError('CANCELLED'); };
    try {
      check(); const context = await this.context(instanceId.toLowerCase(), signal); check();
      if (context.instanceId !== instanceId.toLowerCase() || context.revision !== expectedRevision) throw new ModInventoryError('REVISION_CONFLICT');
      await guardDirectory(path.dirname(context.modsDirectory));
      const names = await this.names(context.modsDirectory, check); const items: ModInventoryItem[] = []; const stamps = new Map<string, FileStamp>();
      let factsBytes = 0;
      for (const filename of names) {
        check(); const target = path.join(context.modsDirectory, filename); const before = await stamp(target);
        const item: ModInventoryItem = { fileId: digest({ instanceId: context.instanceId, filename }), filename, enabled: !filename.toLowerCase().endsWith('.disabled'),
          size: before.size, sha1: null, sha256: null, sha512: null, archives: [], issues: [] };
        if (!before.regular) item.issues.push('UNSAFE_ARCHIVE');
        else {
          try {
            const scan = await this.scanner.read(target, signal); check();
            item.size = scan.size; item.sha1 = scan.sha1; item.sha256 = scan.sha256; item.sha512 = scan.sha512;
            item.archives = archiveFacts(scan);
          } catch (error) {
            check(); if (!(error instanceof ModArchiveError)) throw error;
            item.issues.push(error.code);
          }
        }
        const after = await stamp(target); if (digest(before) !== digest(after)) throw new ModInventoryError('FILES_CHANGED');
        stamps.set(filename, after); factsBytes += Buffer.byteLength(JSON.stringify(item));
        if (factsBytes > 8 * 1024 ** 2) throw new ModInventoryError('MOD_LIMIT');
        items.push(item);
      }
      check();
      if (digest(names) !== digest(await this.names(context.modsDirectory, check))) throw new ModInventoryError('FILES_CHANGED');
      for (const filename of names) { check(); if (digest(stamps.get(filename)) !== digest(await stamp(path.join(context.modsDirectory, filename)))) throw new ModInventoryError('FILES_CHANGED'); }
      const latest = await this.context(instanceId.toLowerCase(), signal); check();
      if (digest(latest) !== digest(context)) throw new ModInventoryError('REVISION_CONFLICT');
      const fingerprint = modInventoryFingerprint(context.instanceId, expectedRevision, items);
      return { instanceId: context.instanceId, revision: expectedRevision, fingerprint, items, local: checkLocalMods(items, context.environment) };
    } catch (error) {
      if (error instanceof ModInventoryError) throw error;
      if (signal?.aborted) throw new ModInventoryError('CANCELLED');
      if (hasCode(error, 'ENOENT')) throw new ModInventoryError('FILES_CHANGED');
      if (hasCode(error, 'UNSAFE_PATH')) throw new ModInventoryError('MODS_UNSAFE');
      throw new ModInventoryError('SCAN_FAILED');
    } finally { this.active = false; }
  }

  private async names(directory: string, check: () => void): Promise<string[]> {
    try { await guardDirectory(directory); }
    catch (error) { if (hasCode(error, 'ENOENT')) return []; throw error; }
    const names: string[] = []; let entries = 0;
    for await (const entry of await opendir(directory)) {
      check(); if (++entries > 4096) throw new ModInventoryError('MOD_LIMIT');
      if (!/\.jar(?:\.disabled)?$/i.test(entry.name)) continue;
      try { validateComponent(entry.name); } catch { throw new ModInventoryError('MODS_UNSAFE'); }
      names.push(entry.name); if (names.length > 256) throw new ModInventoryError('MOD_LIMIT');
    }
    return names.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  }
}
