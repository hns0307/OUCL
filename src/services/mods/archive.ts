import { createHash } from 'node:crypto';
import path from 'node:path';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { inspectModArchiveBytes, NativeArchiveError } from '../install/native-archive.js';

export const MOD_DOCUMENTS = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml',
  'META-INF/neoforge.mods.toml', 'META-INF/jarjar/metadata.json', 'META-INF/MANIFEST.MF'] as const;
export interface ModArchiveDocument { name: typeof MOD_DOCUMENTS[number]; body: string }
export interface ModArchiveNode { entries: string[]; sha256: string; documents: ModArchiveDocument[] }
export interface ModArchiveScan { size: number; sha1: string; sha256: string; sha512: string; archives: ModArchiveNode[] }
export const MOD_ARCHIVE_CODES = ['INVALID_ARCHIVE', 'UNSAFE_ARCHIVE', 'ARCHIVE_LIMIT', 'ARCHIVE_IO',
  'CANCELLED', 'SCAN_TIMEOUT', 'WORKER_FAILED', 'QUEUE_FULL'] as const;
export type ModArchiveCode = typeof MOD_ARCHIVE_CODES[number];
/** A bounded, redacted diagnostic. Limits and unsupported ZIP formats never count as compatibility success. */
export class ModArchiveError extends Error {
  readonly category: 'validation' | 'disk' | 'system' | 'cancelled' | 'biz';
  constructor(readonly code: ModArchiveCode) {
    super(code); this.name = 'ModArchiveError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'ARCHIVE_IO' ? 'disk'
      : code === 'WORKER_FAILED' || code === 'SCAN_TIMEOUT' ? 'system' : code === 'QUEUE_FULL' ? 'biz' : 'validation';
  }
}

/** Reads local bytes without an upstream trust claim, including every nested JAR for later declaration selection.
 * Discovery does not make an undeclared embedded JAR an installed provider. No file is changed.
 */
export async function scanModArchive(file: string): Promise<ModArchiveScan> {
  try {
    if (!path.isAbsolute(file)) throw new ModArchiveError('UNSAFE_ARCHIVE');
    await guardDirectory(path.dirname(file));
    const bytes = await readRegular(file, 64 * 1024 ** 2);
    if (!bytes) throw new ModArchiveError('ARCHIVE_IO');
    const digest = (algorithm: string, body: Buffer): string => createHash(algorithm).update(body).digest('hex');
    const archives: ModArchiveNode[] = []; let expanded = 0; let documentBytes = 0;
    const visit = (body: Buffer, entries: string[]): void => {
      if (entries.length > 4 || archives.length >= 64) throw new ModArchiveError('ARCHIVE_LIMIT');
      const inspected = inspectModArchiveBytes(body, MOD_DOCUMENTS, 256 * 1024 ** 2 - expanded);
      expanded += inspected.bytes;
      const node: ModArchiveNode = { entries, sha256: digest('sha256', body), documents: [] }; archives.push(node);
      for (const selected of inspected.selected) {
        if ((MOD_DOCUMENTS as readonly string[]).includes(selected.name)) {
          documentBytes += selected.body.length;
          if (documentBytes > 4 * 1024 ** 2) throw new ModArchiveError('ARCHIVE_LIMIT');
          let text: string;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(selected.body); }
          catch { throw new ModArchiveError('INVALID_ARCHIVE'); }
          node.documents.push({ name: selected.name as ModArchiveDocument['name'], body: text });
        } else visit(selected.body, [...entries, selected.name]);
      }
    };
    visit(bytes, []);
    return { size: bytes.length, sha1: digest('sha1', bytes), sha256: digest('sha256', bytes), sha512: digest('sha512', bytes), archives };
  } catch (error) {
    if (error instanceof ModArchiveError) throw error;
    if (error instanceof NativeArchiveError && error.code !== 'HASH_MISMATCH') throw new ModArchiveError(error.code);
    if (hasCode(error, 'UNSAFE_PATH')) throw new ModArchiveError('UNSAFE_ARCHIVE');
    throw new ModArchiveError('ARCHIVE_IO');
  }
}
