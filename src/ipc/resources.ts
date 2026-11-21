import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isResourcePayload, isResourceData, ResourceContractError, resourceFailure } from '../shared/contracts/resources.js';
import type { ResourceChannel, ResourceResult, ResourceDispatcher } from '../shared/contracts/resources.js';

/** Validates the trusted document and strict versioned resource envelope before service access. */
export async function handleResources<C extends ResourceChannel>(channel: C, input: unknown, trusted: boolean, traceId: string, dispatch: ResourceDispatcher): Promise<ResourceResult<C>> {
  const valid = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = valid && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return resourceFailure(id, 'INVALID_SENDER', traceId);
  if (valid && typeof input.contractVersion === 'number' && input.contractVersion > 1) return resourceFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!valid || input.contractVersion !== 1 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId) || !isResourcePayload(input.payload, channel)) return resourceFailure(id, 'INVALID_ARGUMENT', traceId);
  try { const data = await dispatch(channel, input.payload, id); if (!isResourceData(data, channel)) throw new ResourceContractError('UNAVAILABLE'); return { contractVersion: 1, requestId: id, ok: true, data }; }
  catch (error) { return resourceFailure(id, error instanceof ResourceContractError ? error.code : 'UNAVAILABLE', traceId); }
}
