import { fixedPackPreview } from '../../core/packs/fixed-preview.js';
import type { FixedPackPreview } from '../../core/packs/fixed-preview.js';
import { exactObject, UUID_PATTERN } from './handshake.js';
import type { ErrorCategory } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const PACK_CAPABILITY = 'packs.fixed-preview.v1' as const;
export const PACK_CHANNEL = 'packs:inspectFixed' as const;
export type PackCode = 'INVALID_ARGUMENT' | 'INVALID_SENDER' | 'UNSUPPORTED_CONTRACT' | 'UNAVAILABLE' | 'TIMEOUT' | 'FIXED_SAMPLE_MISMATCH' | 'CANCELLED';
export type PackData = { state: 'cancelled' } | { state: 'preview'; preview: FixedPackPreview };
export type PackResult = { contractVersion: 1; requestId: string; ok: true; data: PackData }
  | { contractVersion: 1; requestId: string; ok: false; error: { category: ErrorCategory; code: PackCode; messageKey: MessageKey; retryable: boolean; traceId: string } };
export interface PacksBridge { inspectFixedPack(requestId: string): Promise<PackResult> }
const ERRORS: Record<PackCode, { category: ErrorCategory; messageKey: MessageKey; retryable: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  INVALID_SENDER: { category: 'permission', messageKey: 'invalidSender', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', messageKey: 'unsupportedContract', retryable: false },
  UNAVAILABLE: { category: 'system', messageKey: 'unavailable', retryable: true },
  TIMEOUT: { category: 'system', messageKey: 'timeout', retryable: true },
  FIXED_SAMPLE_MISMATCH: { category: 'validation', messageKey: 'packSampleMismatch', retryable: false },
  CANCELLED: { category: 'cancelled', messageKey: 'packCheckCancelled', retryable: true },
};
/** Constructs a fixed, redacted public error. */
export function packFailure(requestId: string, code: PackCode, traceId: string): PackResult {
  return { contractVersion: 1, requestId, ok: false, error: { ...ERRORS[code], code, traceId } };
}
/** Strict response validation prevents forged paths, status and unsolicited fields. */
export function isPackResult(value: unknown, requestId: string): value is PackResult {
  if (!exactObject(value, value && typeof value === 'object' && 'ok' in value && value.ok === true
    ? ['contractVersion', 'requestId', 'ok', 'data'] : ['contractVersion', 'requestId', 'ok', 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId || !UUID_PATTERN.test(requestId)) return false;
  if (value.ok === true) {
    if (exactObject(value.data, ['state']) && value.data.state === 'cancelled') return true;
    return exactObject(value.data, ['state', 'preview']) && value.data.state === 'preview'
      && JSON.stringify(value.data.preview) === JSON.stringify(fixedPackPreview(889));
  }
  if (value.ok !== false || !exactObject(value.error, ['category', 'code', 'messageKey', 'retryable', 'traceId'])
    || typeof value.error.code !== 'string' || !Object.hasOwn(ERRORS, value.error.code)
    || typeof value.error.traceId !== 'string' || !UUID_PATTERN.test(value.error.traceId)) return false;
  const expected = ERRORS[value.error.code as PackCode];
  return value.error.category === expected.category && value.error.messageKey === expected.messageKey && value.error.retryable === expected.retryable;
}
