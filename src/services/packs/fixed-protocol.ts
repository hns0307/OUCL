import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import { fixedPackPreview } from '../../core/packs/fixed-preview.js';
import type { FixedPackPreview } from '../../core/packs/fixed-preview.js';

export interface FixedPackRequest { version: 1; kind: 'fixed-pack-preview'; file: string }
export type FixedPackReply = { version: 1; kind: 'fixed-pack-result'; preview: FixedPackPreview }
  | { version: 1; kind: 'fixed-pack-failed'; code: 'INVALID_SAMPLE' | 'READ_FAILED' | 'UNSAFE_PATH' | 'WORKER_FAILED' };
/** The selected path is private to the service and is never sent to the renderer. */
export function parseFixedPackRequest(value: unknown): FixedPackRequest {
  if (!exactObject(value, ['version', 'kind', 'file']) || value.version !== 1 || value.kind !== 'fixed-pack-preview'
    || typeof value.file !== 'string' || !path.isAbsolute(value.file) || value.file.length > 32760) throw new Error('INVALID_MESSAGE');
  return value as unknown as FixedPackRequest;
}
/** Rejects extra fields and any worker facts differing from the reviewed projection. */
export function parseFixedPackReply(value: unknown): FixedPackReply {
  if (exactObject(value, ['version', 'kind', 'code']) && value.version === 1 && value.kind === 'fixed-pack-failed'
    && (value.code === 'INVALID_SAMPLE' || value.code === 'READ_FAILED' || value.code === 'UNSAFE_PATH' || value.code === 'WORKER_FAILED')) return value as FixedPackReply;
  if (!exactObject(value, ['version', 'kind', 'preview']) || value.version !== 1 || value.kind !== 'fixed-pack-result'
    || JSON.stringify(value.preview) !== JSON.stringify(fixedPackPreview(889))) throw new Error('INVALID_MESSAGE');
  return value as unknown as FixedPackReply;
}
