import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { instanceFailure, InstanceContractError, isInstanceRequest, isInstanceResult } from '../shared/contracts/instances.js';
import type { InstanceChannel, InstanceDispatcher, InstanceResult } from '../shared/contracts/instances.js';

/** Checks sender and approved DTOs before dispatch, then validates redacted service output before returning it. */
export async function handleInstances<C extends InstanceChannel>(channel: C, input: unknown, trustedSender: boolean, traceId: string,
  dispatch: InstanceDispatcher): Promise<InstanceResult<C>> {
  const id = exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trustedSender) return instanceFailure(id, 'INVALID_SENDER', traceId);
  if (exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.contractVersion === 'number' && input.contractVersion > 1
    && isInstanceRequest({ ...input, contractVersion: 1 }, channel)) return instanceFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!isInstanceRequest(input, channel)) return instanceFailure(id, 'INVALID_ARGUMENT', traceId);
  try {
    const result: InstanceResult<C> = { contractVersion: 1, requestId: id, ok: true, data: await dispatch(channel, input.payload, id) };
    if (!isInstanceResult(result, id, channel)) return instanceFailure(id, 'UNAVAILABLE', traceId);
    if ('taskId' in input.payload) {
      const data = result.data;
      const returned = 'snapshot' in data ? data.snapshot.taskId : 'taskId' in data ? data.taskId : undefined;
      if (returned !== input.payload.taskId) return instanceFailure(id, 'UNAVAILABLE', traceId);
    }
    return result;
  } catch (error) { return instanceFailure(id, error instanceof InstanceContractError ? error.code : 'UNAVAILABLE', traceId); }
}
