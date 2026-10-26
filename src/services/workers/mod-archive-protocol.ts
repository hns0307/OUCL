import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import { installRelativePath } from '../../core/install/assets.js';
import { MOD_ARCHIVE_CODES, MOD_DOCUMENTS } from '../mods/archive.js';
import type { ModArchiveCode, ModArchiveScan } from '../mods/archive.js';
import { parseModDeclarationFacts } from './mod-declarations-protocol.js';

export interface ModArchiveRequest { version: 1; kind: 'mod-archive'; file: string }
export type ModArchiveReply = { version: 1; kind: 'mod-archive-result'; result: ModArchiveScan }
  | { version: 1; kind: 'mod-archive-failed'; code: ModArchiveCode };
function invalid(): never { throw new Error('INVALID_MESSAGE'); }
const digest = (value: unknown, length: number): boolean => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);

/** The internal service selects the file; no scripts, URLs, entry selectors or execution arguments are accepted. */
export function parseModArchiveRequest(value: unknown): ModArchiveRequest {
  if (!exactObject(value, ['version', 'kind', 'file']) || value.version !== 1 || value.kind !== 'mod-archive'
    || typeof value.file !== 'string' || !value.file.length || value.file.length > 32760 || !path.isAbsolute(value.file)) invalid();
  return value as unknown as ModArchiveRequest;
}

/** Revalidates bounded worker facts; raw bodies stay private to the main-process declaration parser. */
export function parseModArchiveReply(value: unknown): ModArchiveReply {
  if (exactObject(value, ['version', 'kind', 'code']) && value.version === 1 && value.kind === 'mod-archive-failed'
    && typeof value.code === 'string' && MOD_ARCHIVE_CODES.includes(value.code as ModArchiveCode)) return value as ModArchiveReply;
  if (!exactObject(value, ['version', 'kind', 'result']) || value.version !== 1 || value.kind !== 'mod-archive-result') invalid();
  const result = value.result;
  if (!exactObject(result, ['size', 'sha1', 'sha256', 'sha512', 'archives']) || typeof result.size !== 'number'
    || !Number.isSafeInteger(result.size) || result.size < 1 || result.size > 64 * 1024 ** 2
    || !digest(result.sha1, 40) || !digest(result.sha256, 64) || !digest(result.sha512, 128)
    || !Array.isArray(result.archives) || result.archives.length < 1 || result.archives.length > 64) invalid();
  let total = 0; const seen = new Set<string>();
  for (const [index, archive] of result.archives.entries()) {
    if (!exactObject(archive, ['entries', 'sha256', 'documents', 'declarations']) || !digest(archive.sha256, 64)
      || !Array.isArray(archive.entries) || archive.entries.length > 4 || (index === 0) !== (archive.entries.length === 0)
      || !Array.isArray(archive.documents) || archive.documents.length > MOD_DOCUMENTS.length
      || !Array.isArray(archive.declarations) || archive.declarations.length > 4) invalid();
    for (const entry of archive.entries) {
      if (typeof entry !== 'string' || entry.length > 4096 || !entry.endsWith('.jar')) invalid();
      try { installRelativePath(entry); } catch { invalid(); }
    }
    const identity = JSON.stringify(archive.entries); if (seen.has(identity)) invalid(); seen.add(identity);
    if (index === 0 && archive.sha256 !== result.sha256) invalid();
    if (index > 0 && !seen.has(JSON.stringify(archive.entries.slice(0, -1)))) invalid();
    const names = new Set<string>();
    for (const document of archive.documents) {
      if (!exactObject(document, ['name', 'body']) || typeof document.name !== 'string'
        || !(MOD_DOCUMENTS as readonly string[]).includes(document.name) || names.has(document.name)
        || typeof document.body !== 'string' || Buffer.byteLength(document.body) > 1024 ** 2) invalid();
      names.add(document.name); total += Buffer.byteLength(document.body); if (total > 4 * 1024 ** 2) invalid();
    }
    const formats = new Set<string>();
    for (const declaration of archive.declarations) {
      const facts = parseModDeclarationFacts(declaration);
      const name = { fabric: 'fabric.mod.json', quilt: 'quilt.mod.json', forge: 'META-INF/mods.toml', neoforge: 'META-INF/neoforge.mods.toml' }[facts.format];
      if (formats.has(facts.format) || !names.has(name)) invalid(); formats.add(facts.format);
    }
    if (formats.size !== [...names].filter(name => name.endsWith('mods.toml') || name.endsWith('mod.json')).length) invalid();
  }
  try { if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 ** 2) invalid(); } catch { invalid(); }
  return value as unknown as ModArchiveReply;
}
