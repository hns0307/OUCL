import { CONTRACT_VERSION, UUID_PATTERN, exactObject, isHandshakeRequest } from '../shared/contracts/handshake.js';
import type { AppError, HandshakeErrorCode, HandshakeResult } from '../shared/contracts/handshake.js';

/** Returns a redacted failure; caller supplies a fresh trace ID, never raw input. */
export function handshakeFailure(requestId: string, code: HandshakeErrorCode, traceId: string): HandshakeResult {
  const error: AppError = code === 'INVALID_SENDER'
    ? { category: 'permission', code, messageKey: 'invalidSender', retryable: false, traceId }
    : code === 'UNSUPPORTED_CONTRACT'
      ? { category: 'validation', code, messageKey: 'unsupportedContract', retryable: false, traceId }
      : code === 'INVALID_ARGUMENT'
        ? { category: 'validation', code, messageKey: 'invalidArgument', retryable: false, traceId }
        : { category: 'system', code, messageKey: code === 'TIMEOUT' ? 'timeout' : 'unavailable', retryable: true, traceId };
  return { contractVersion: CONTRACT_VERSION, requestId, ok: false, error };
}

/** Uses exact document identity and the main frame; no prefix-based sender checks. */
export function isTrustedDocument(actualUrl: string, expectedUrl: string, sameWebContents: boolean, mainFrame: boolean): boolean {
  return sameWebContents && mainFrame && actualUrl === expectedUrl;
}

/** Negotiates the empty contract without exposing business capabilities. */
export function negotiateHandshake(input: unknown, trusted: boolean, sessionId: string, traceId: string): HandshakeResult {
  const futureEnvelope = exactObject(input, ['contractVersion', 'requestId', 'payload'])
    && typeof input.contractVersion === 'number' && Number.isSafeInteger(input.contractVersion) && input.contractVersion > CONTRACT_VERSION
    && isHandshakeRequest({ ...input, contractVersion: CONTRACT_VERSION });
  const requestId = isHandshakeRequest(input) || futureEnvelope ? input.requestId as string : traceId;
  if (!trusted) return handshakeFailure(requestId, 'INVALID_SENDER', traceId);
  if (futureEnvelope) return handshakeFailure(requestId, 'UNSUPPORTED_CONTRACT', traceId);
  if (!isHandshakeRequest(input)) return handshakeFailure(requestId, 'INVALID_ARGUMENT', traceId);
  if (!input.payload.supportedVersions.includes(CONTRACT_VERSION)) return handshakeFailure(requestId, 'UNSUPPORTED_CONTRACT', traceId);
  if (!UUID_PATTERN.test(sessionId)) return handshakeFailure(requestId, 'UNAVAILABLE', traceId);
  return { contractVersion: CONTRACT_VERSION, requestId, ok: true, data: { selectedVersion: CONTRACT_VERSION, capabilities: [], sessionId } };
}
