import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import type { SelectedArchiveInput } from '../install/native-archive.js';
import { NATIVE_CODES } from './native-protocol.js';
import type { NativeCode } from './native-protocol.js';

export interface ArchiveValidationRequest extends SelectedArchiveInput { version: 1; kind: 'processor-output-validate' }
export type ArchiveValidationReply = { version: 1; kind: 'processor-output-valid'; entries: number; bytes: number }
  | { version: 1; kind: 'processor-output-invalid'; code: NativeCode };

export function parseArchiveValidationRequest(value: unknown): ArchiveValidationRequest {
  if (!exactObject(value, ['version', 'kind', 'file', 'sha256', 'size']) || value.version !== 1 || value.kind !== 'processor-output-validate'
    || typeof value.file !== 'string' || value.file.length > 32760 || !path.isAbsolute(value.file)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2) throw new Error('INVALID_ARCHIVE');
  return value as unknown as ArchiveValidationRequest;
}
export function parseArchiveValidationReply(value: unknown): ArchiveValidationReply {
  if (exactObject(value, ['version', 'kind', 'entries', 'bytes']) && value.version === 1 && value.kind === 'processor-output-valid'
    && typeof value.entries === 'number' && Number.isSafeInteger(value.entries) && value.entries >= 1 && value.entries <= 4096
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= 256 * 1024 ** 2) return value as ArchiveValidationReply;
  if (exactObject(value, ['version', 'kind', 'code']) && value.version === 1 && value.kind === 'processor-output-invalid'
    && typeof value.code === 'string' && NATIVE_CODES.includes(value.code as NativeCode)) return value as ArchiveValidationReply;
  throw new Error('INVALID_ARCHIVE');
}
