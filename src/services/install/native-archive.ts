import { createHash } from 'node:crypto';
import { mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { installRelativePath } from '../../core/install/assets.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';

export type NativeArchiveCode = 'INVALID_ARCHIVE' | 'UNSAFE_ARCHIVE' | 'ARCHIVE_LIMIT' | 'HASH_MISMATCH' | 'ARCHIVE_IO';
/** Fixed extraction failure without archive names, filesystem paths or upstream exception text. */
export class NativeArchiveError extends Error {
  readonly category: 'validation' | 'network' | 'disk';
  constructor(readonly code: NativeArchiveCode) {
    super(code); this.name = 'NativeArchiveError';
    this.category = code === 'HASH_MISMATCH' ? 'network' : code === 'ARCHIVE_IO' ? 'disk' : 'validation';
  }
}
export interface NativeArchiveInput { file: string; sha256: string; size: number; exclude: string[] }
export interface SelectedArchiveInput { file: string; sha256: string; size: number }
interface Entry { name: string; directory: boolean; method: number; crc: number; size: number; compressed: Buffer; start: number; end: number; excluded: boolean }
const MAX_ARCHIVE = 64 * 1024 ** 2;
const MAX_TOTAL = 256 * 1024 ** 2;
const MAX_ENTRIES = 4096;
const bad = (): never => { throw new NativeArchiveError('INVALID_ARCHIVE'); };
const unsafe = (): never => { throw new NativeArchiveError('UNSAFE_ARCHIVE'); };
const limit = (): never => { throw new NativeArchiveError('ARCHIVE_LIMIT'); };

function extra(bytes: Buffer): void {
  for (let position = 0; position < bytes.length;) {
    if (position + 4 > bytes.length) bad();
    const kind = bytes.readUInt16LE(position); const length = bytes.readUInt16LE(position + 2); position += 4;
    if (position + length > bytes.length) bad();
    // ZIP64, Unix link metadata and alternate Unicode paths introduce unsupported identities.
    if ([0x0001, 0x000d, 0x756e, 0x7075].includes(kind)) unsafe();
    position += length;
  }
}
function nameOf(bytes: Buffer, flags: number): { name: string; directory: boolean } {
  let decoded: string;
  try {
    if (!(flags & 0x800) && bytes.some(value => value > 127)) unsafe();
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return unsafe(); }
  const directory = decoded.endsWith('/'); const name = directory ? decoded.slice(0, -1) : decoded;
  try { installRelativePath(name); } catch { return unsafe(); }
  return { name, directory };
}
function excludes(values: readonly string[]): string[] {
  if (values.length > 64) limit();
  return ['META-INF/', ...values].map(value => {
    if (typeof value !== 'string') unsafe();
    try { installRelativePath(value.endsWith('/') ? value.slice(0, -1) : value); } catch { unsafe(); }
    return value;
  });
}
function parse(bytes: Buffer, exclude: readonly string[]): Entry[] {
  if (bytes.length < 22) bad();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) bad();
  const count = bytes.readUInt16LE(end + 10); const centralSize = bytes.readUInt32LE(end + 12); const central = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || bytes.readUInt16LE(end + 8) !== count
    || count === 0xffff || centralSize === 0xffffffff || central === 0xffffffff || central + centralSize !== end) bad();
  if (count > MAX_ENTRIES) limit();
  const entries: Entry[] = []; const names = new Set<string>(); const excluded = excludes(exclude); let cursor = central;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) bad();
    const version = bytes.readUInt16LE(cursor + 6); const flags = bytes.readUInt16LE(cursor + 8); const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16); const compressedSize = bytes.readUInt32LE(cursor + 20); const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28); const extraLength = bytes.readUInt16LE(cursor + 30); const commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38); const start = bytes.readUInt32LE(cursor + 42);
    if (version > 20 || flags & ~0x080e || method !== 0 && method !== 8 || method === 0 && flags & 6
      || bytes.readUInt16LE(cursor + 34) !== 0 || compressedSize === 0xffffffff || size === 0xffffffff || start === 0xffffffff) bad();
    if (size > MAX_ARCHIVE) limit();
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || next > end || start + 30 > central || bytes.readUInt32LE(start) !== 0x04034b50) bad();
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength); const identity = nameOf(rawName, flags);
    if (names.has(identity.name.toLowerCase())) unsafe(); names.add(identity.name.toLowerCase());
    const mode = external >>> 16; const kind = mode & 0xf000;
    if (kind !== 0 && kind !== (identity.directory ? 0x4000 : 0x8000) || external & 0x400
      || Boolean(external & 0x10) && !identity.directory) unsafe();
    if (identity.directory && (size !== 0 || crc !== 0)) bad();
    extra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    if (bytes.readUInt16LE(start + 4) !== version || bytes.readUInt16LE(start + 6) !== flags || bytes.readUInt16LE(start + 8) !== method) bad();
    const localCrc = bytes.readUInt32LE(start + 14); const localCompressed = bytes.readUInt32LE(start + 18); const localSize = bytes.readUInt32LE(start + 22);
    if (flags & 8 ? (localCrc !== 0 && localCrc !== crc || localCompressed !== 0 && localCompressed !== compressedSize || localSize !== 0 && localSize !== size)
      : localCrc !== crc || localCompressed !== compressedSize || localSize !== size) bad();
    const localName = bytes.readUInt16LE(start + 26); const localExtra = bytes.readUInt16LE(start + 28); const data = start + 30 + localName + localExtra;
    if (data + compressedSize > central || !bytes.subarray(start + 30, start + 30 + localName).equals(rawName)) bad();
    extra(bytes.subarray(start + 30 + localName, data));
    let finish = data + compressedSize;
    if (flags & 8) {
      if (finish + 12 > central) bad();
      const descriptor = bytes.readUInt32LE(finish) === 0x08074b50 ? finish + 4 : finish;
      if (descriptor + 12 > central || bytes.readUInt32LE(descriptor) !== crc || bytes.readUInt32LE(descriptor + 4) !== compressedSize || bytes.readUInt32LE(descriptor + 8) !== size) bad();
      finish = descriptor + 12;
    }
    if (method === 0 && compressedSize !== size) bad();
    entries.push({ ...identity, method, crc, size, compressed: bytes.subarray(data, data + compressedSize), start, end: finish,
      excluded: excluded.some(prefix => (identity.name + (identity.directory ? '/' : '')).startsWith(prefix)) });
    cursor = next;
  }
  if (cursor !== end) bad();
  const ordered = [...entries].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.start < ordered[i - 1]!.end) unsafe();
  return entries;
}
function checkPaths(entries: readonly Entry[]): void {
  const files = new Set<string>(); const directories = new Map<string, string>();
  for (const entry of entries) {
    if (entry.excluded) continue;
    const parts = entry.name.split('/'); let name = '';
    for (let i = 0; i < parts.length; i++) {
      name = name ? `${name}/${parts[i]!}` : parts[i]!; const folded = name.toLowerCase();
      const isDirectory = i < parts.length - 1 || entry.directory;
      if (files.has(folded)) unsafe();
      if (isDirectory) {
        const old = directories.get(folded); if (old !== undefined && old !== name) unsafe(); directories.set(folded, name);
      } else {
        if (directories.has(folded)) unsafe(); files.add(folded);
      }
    }
  }
}
async function prepareDirectory(root: string, name: string): Promise<string> {
  let current = root;
  for (const part of name.split('/').filter(Boolean)) {
    await guardDirectory(current); current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
    await guardDirectory(current);
  }
  return current;
}
function unpack(entry: Entry): Buffer {
  let body: Buffer;
  if (entry.method === 0) body = entry.compressed;
  else {
    try {
      // Node's declarations omit the info:true return shape; validate it as unknown before use.
      const result: unknown = inflateRawSync(entry.compressed, { maxOutputLength: Math.max(1, entry.size), info: true });
      if (typeof result !== 'object' || result === null || !('buffer' in result) || !Buffer.isBuffer(result.buffer)
        || !('engine' in result) || typeof result.engine !== 'object' || result.engine === null
        || !('bytesWritten' in result.engine) || result.engine.bytesWritten !== entry.compressed.length) return bad();
      body = result.buffer;
    } catch { return bad(); }
  }
  if (body.length !== entry.size || crc32(body) !== entry.crc) bad();
  return body;
}

/** Extracts verified native ZIPs into an existing empty private workspace; invoke only in a bounded worker.
 * All headers, global resource budgets and destination collisions are checked before the first write.
 * Failure leaves only this private workspace for recovery; no rollback or player-directory mutation is claimed.
 */
export async function extractNativeArchives(destination: string, archives: readonly NativeArchiveInput[]): Promise<{ files: number; bytes: number }> {
  try {
    const root = await guardDirectory(destination);
    if ((await readdir(root)).length !== 0) unsafe();
    if (!Array.isArray(archives) || archives.length > 64) limit();
    const entries: Entry[] = []; let total = 0; let compressed = 0;
    for (const archive of archives) {
      if (!archive || typeof archive.file !== 'string' || !path.isAbsolute(archive.file) || typeof archive.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(archive.sha256) || !Number.isSafeInteger(archive.size) || archive.size < 0 || !Array.isArray(archive.exclude)) bad();
      if (archive.size > MAX_ARCHIVE || (compressed += archive.size) > MAX_TOTAL) limit();
      await guardDirectory(path.dirname(archive.file));
      const bytes = await readRegular(archive.file, MAX_ARCHIVE);
      if (!bytes || bytes.length !== archive.size || createHash('sha256').update(bytes).digest('hex') !== archive.sha256) throw new NativeArchiveError('HASH_MISMATCH');
      const parsed = parse(bytes, archive.exclude);
      entries.push(...parsed);
      if (entries.length > MAX_ENTRIES) limit();
      for (const entry of parsed) { total += entry.size; if (total > MAX_TOTAL) limit(); }
    }
    checkPaths(entries);
    await guardDirectory(root); if ((await readdir(root)).length !== 0) unsafe();
    let files = 0; let written = 0;
    for (const entry of entries) {
      const body = unpack(entry);
      if (entry.excluded) continue;
      if (entry.directory) { await prepareDirectory(root, entry.name); continue; }
      const directory = await prepareDirectory(root, entry.name.split('/').slice(0, -1).join('/'));
      await guardDirectory(directory);
      const handle = await open(path.join(directory, entry.name.split('/').at(-1)!), 'wx');
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      files++; written += entry.size;
    }
    return { files, bytes: written };
  } catch (error) {
    if (error instanceof NativeArchiveError) throw error;
    if (hasCode(error, 'UNSAFE_PATH') || hasCode(error, 'EEXIST')) unsafe();
    throw new NativeArchiveError('ARCHIVE_IO');
  }
}

/** Extracts an exact service-selected subset from one verified ZIP into an empty private workspace. */
export async function extractSelectedArchive(destination: string, archive: SelectedArchiveInput,
  selected: readonly string[]): Promise<{ files: number; bytes: number }> {
  try {
    const root = await guardDirectory(destination);
    if ((await readdir(root)).length !== 0) unsafe();
    if (!archive || typeof archive.file !== 'string' || !path.isAbsolute(archive.file)
      || typeof archive.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archive.sha256)
      || !Number.isSafeInteger(archive.size) || archive.size < 1 || archive.size > MAX_ARCHIVE
      || !Array.isArray(selected) || selected.length < 1 || selected.length > 16) bad();
    const wanted = new Set<string>();
    for (const name of selected) {
      if (typeof name !== 'string') unsafe();
      try { installRelativePath(name); } catch { unsafe(); }
      const folded = name.toLowerCase(); if (wanted.has(folded)) unsafe(); wanted.add(folded);
    }
    await guardDirectory(path.dirname(archive.file));
    const bytes = await readRegular(archive.file, MAX_ARCHIVE);
    if (!bytes || bytes.length !== archive.size || createHash('sha256').update(bytes).digest('hex') !== archive.sha256) throw new NativeArchiveError('HASH_MISMATCH');
    const entries = parse(bytes, []); checkPaths(entries);
    let total = 0; for (const entry of entries) { total += entry.size; if (total > MAX_TOTAL) limit(); }
    const chosen = entries.filter(entry => !entry.directory && !entry.excluded && wanted.has(entry.name.toLowerCase()));
    if (chosen.length !== wanted.size) bad();
    let selectedBytes = 0; for (const entry of chosen) { selectedBytes += entry.size; if (selectedBytes > MAX_ARCHIVE) limit(); }
    await guardDirectory(root); if ((await readdir(root)).length !== 0) unsafe();
    for (const entry of chosen) {
      const body = unpack(entry); const directory = await prepareDirectory(root, entry.name.split('/').slice(0, -1).join('/'));
      await guardDirectory(directory); const handle = await open(path.join(directory, entry.name.split('/').at(-1)!), 'wx');
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
    }
    return { files: chosen.length, bytes: selectedBytes };
  } catch (error) {
    if (error instanceof NativeArchiveError) throw error;
    if (hasCode(error, 'UNSAFE_PATH') || hasCode(error, 'EEXIST')) unsafe();
    throw new NativeArchiveError('ARCHIVE_IO');
  }
}

/** Reads one fixed entry from a verified ZIP. Invoke only in a bounded worker. */
export async function readVerifiedArchiveEntry(archive: SelectedArchiveInput, selected: string,
  maximumBytes: number): Promise<Buffer> {
  try {
    if (!archive || typeof archive.file !== 'string' || !path.isAbsolute(archive.file)
      || typeof archive.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archive.sha256)
      || !Number.isSafeInteger(archive.size) || archive.size < 1 || archive.size > MAX_ARCHIVE
      || typeof selected !== 'string' || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_ARCHIVE) bad();
    try { installRelativePath(selected); } catch { unsafe(); }
    await guardDirectory(path.dirname(archive.file));
    const bytes = await readRegular(archive.file, MAX_ARCHIVE);
    if (!bytes || bytes.length !== archive.size || createHash('sha256').update(bytes).digest('hex') !== archive.sha256) {
      throw new NativeArchiveError('HASH_MISMATCH');
    }
    const entries = parse(bytes, []);
    let total = 0; for (const entry of entries) { total += entry.size; if (total > MAX_TOTAL) limit(); }
    const chosen = entries.filter(entry => !entry.directory && entry.name.toLowerCase() === selected.toLowerCase());
    if (chosen.length !== 1) bad();
    if (chosen[0]!.size > maximumBytes) limit();
    return unpack(chosen[0]!);
  } catch (error) {
    if (error instanceof NativeArchiveError) throw error;
    if (hasCode(error, 'UNSAFE_PATH')) unsafe();
    throw new NativeArchiveError('ARCHIVE_IO');
  }
}

/** Fully inflates one verified ZIP to detect corrupt or empty processor output. Invoke only in a bounded worker. */
export async function validateVerifiedArchive(archive: SelectedArchiveInput): Promise<{ entries: number; bytes: number }> {
  try {
    if (!archive || typeof archive.file !== 'string' || !path.isAbsolute(archive.file)
      || typeof archive.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archive.sha256)
      || !Number.isSafeInteger(archive.size) || archive.size < 1 || archive.size > MAX_ARCHIVE) bad();
    await guardDirectory(path.dirname(archive.file));
    const bytes = await readRegular(archive.file, MAX_ARCHIVE);
    if (!bytes || bytes.length !== archive.size || createHash('sha256').update(bytes).digest('hex') !== archive.sha256) {
      throw new NativeArchiveError('HASH_MISMATCH');
    }
    const entries = parse(bytes, []); let total = 0; let files = 0;
    for (const entry of entries) {
      total += entry.size; if (total > MAX_TOTAL) limit();
      if (!entry.directory) { unpack(entry); files++; }
    }
    if (files < 1) bad();
    return { entries: files, bytes: total };
  } catch (error) {
    if (error instanceof NativeArchiveError) throw error;
    if (hasCode(error, 'UNSAFE_PATH')) unsafe();
    throw new NativeArchiveError('ARCHIVE_IO');
  }
}
