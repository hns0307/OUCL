import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import type { SelectedArchiveInput } from '../install/native-archive.js';
import { NATIVE_CODES } from './native-protocol.js';
import type { NativeCode } from './native-protocol.js';

export interface ProcessorManifestRequest extends SelectedArchiveInput { version: 1; kind: 'processor-manifest' }
export type ProcessorManifestReply = { version: 1; kind: 'processor-manifest-result'; mainClass: string }
  | { version: 1; kind: 'processor-manifest-failed'; code: NativeCode };

export function parseProcessorManifestRequest(value: unknown): ProcessorManifestRequest {
  if (!exactObject(value, ['version', 'kind', 'file', 'sha256', 'size']) || value.version !== 1 || value.kind !== 'processor-manifest'
    || typeof value.file !== 'string' || value.file.length > 32760 || !path.isAbsolute(value.file)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2) throw new Error('INVALID_ARCHIVE');
  return value as unknown as ProcessorManifestRequest;
}

export function parseProcessorManifestReply(value: unknown): ProcessorManifestReply {
  if (exactObject(value, ['version', 'kind', 'mainClass']) && value.version === 1 && value.kind === 'processor-manifest-result'
    && typeof value.mainClass === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value.mainClass)) return value as ProcessorManifestReply;
  if (exactObject(value, ['version', 'kind', 'code']) && value.version === 1 && value.kind === 'processor-manifest-failed'
    && typeof value.code === 'string' && NATIVE_CODES.includes(value.code as NativeCode)) return value as ProcessorManifestReply;
  throw new Error('INVALID_ARCHIVE');
}
