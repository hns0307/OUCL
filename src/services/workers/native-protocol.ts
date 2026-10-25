import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import type { NativeArchiveInput } from '../install/native-archive.js';

export const NATIVE_CODES = ['INVALID_ARCHIVE', 'UNSAFE_ARCHIVE', 'ARCHIVE_LIMIT', 'HASH_MISMATCH', 'ARCHIVE_IO'] as const;
export type NativeCode = typeof NATIVE_CODES[number];
export interface NativeRequest { version: 1; kind: 'native-extract'; destination: string; archives: NativeArchiveInput[] }
export type NativeReply = { version: 1; kind: 'native-result'; files: number; bytes: number }
  | { version: 1; kind: 'native-failed'; code: NativeCode };
const absolute = (value: unknown): value is string => typeof value === 'string' && value.length <= 32760 && path.isAbsolute(value);

/** Restricts the private one-shot native worker to bounded service-selected inputs, never renderer requests. */
export function parseNativeRequest(value: unknown): NativeRequest {
  if (!exactObject(value, ['version', 'kind', 'destination', 'archives']) || value.version !== 1 || value.kind !== 'native-extract'
    || !absolute(value.destination) || !Array.isArray(value.archives) || value.archives.length > 64) throw new Error('INVALID_ARCHIVE');
  const archives = value.archives.map((item: unknown): NativeArchiveInput => {
    if (!exactObject(item, ['file', 'sha256', 'size', 'exclude']) || !absolute(item.file)
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.size !== 'number'
      || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 64 * 1024 * 1024
      || !Array.isArray(item.exclude) || item.exclude.length > 64
      || !item.exclude.every((entry: unknown) => typeof entry === 'string' && entry.length > 0 && entry.length <= 1024)) throw new Error('INVALID_ARCHIVE');
    return { file: item.file, sha256: item.sha256, size: item.size, exclude: [...item.exclude] as string[] };
  });
  return { version: 1, kind: 'native-extract', destination: value.destination, archives };
}

/** Parses exact bounded replies without passing native paths or OS exception messages to the caller. */
export function parseNativeReply(value: unknown): NativeReply {
  if (exactObject(value, ['version', 'kind', 'files', 'bytes']) && value.version === 1 && value.kind === 'native-result'
    && typeof value.files === 'number' && Number.isSafeInteger(value.files) && value.files >= 0 && value.files <= 4096
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 256 * 1024 * 1024) return value as unknown as NativeReply;
  if (exactObject(value, ['version', 'kind', 'code']) && value.version === 1 && value.kind === 'native-failed'
    && typeof value.code === 'string' && NATIVE_CODES.includes(value.code as NativeCode)) return value as unknown as NativeReply;
  throw new Error('INVALID_ARCHIVE');
}
