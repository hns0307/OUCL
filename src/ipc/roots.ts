import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isRootsRequest, rootsFailure } from '../shared/contracts/roots.js';
import type { RootsData, RootsResult } from '../shared/contracts/roots.js';
import { RootError } from '../services/roots/service.js';

/** Checks sender before any native dialog or IO; only exact approved root DTOs reach the service. */
export async function handleRoots(input: unknown, trusted: boolean, traceId: string, action: () => Promise<RootsData>): Promise<RootsResult<RootsData>> {
  const id = exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return rootsFailure(id, 'INVALID_SENDER', traceId);
  if (exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.contractVersion === 'number' && input.contractVersion > 1
    && isRootsRequest({ ...input, contractVersion: 1 })) return rootsFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!isRootsRequest(input)) return rootsFailure(id, 'INVALID_ARGUMENT', traceId);
  try { return { contractVersion: 1, requestId: id, ok: true, data: await action() }; }
  catch (error) { return rootsFailure(id, error instanceof RootError ? error.code : 'ROOT_UNAVAILABLE', traceId); }
}
