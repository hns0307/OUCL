import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { instancesV2Failure, isInstanceV2Summary } from '../shared/contracts/instances-v2.js';
import type { InstancesV2Result } from '../shared/contracts/instances-v2.js';

export async function handleInstancesV2(input: unknown, trusted: boolean, traceId: string,
  list: (rootId: string) => Promise<unknown>): Promise<InstancesV2Result> {
  const valid = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = valid && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return instancesV2Failure(id, 'INVALID_SENDER', traceId);
  if (valid && typeof input.contractVersion === 'number' && input.contractVersion > 2) return instancesV2Failure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!valid || input.contractVersion !== 2 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId)
    || !exactObject(input.payload, ['rootId']) || typeof input.payload.rootId !== 'string' || !UUID_PATTERN.test(input.payload.rootId)) return instancesV2Failure(id, 'INVALID_ARGUMENT', traceId);
  try {
    const items = await list(input.payload.rootId.toLowerCase());
    if (!Array.isArray(items) || items.length > 1000 || !items.every(isInstanceV2Summary)) return instancesV2Failure(id, 'UNAVAILABLE', traceId);
    return { contractVersion: 2, requestId: id, ok: true, data: { items } };
  } catch { return instancesV2Failure(id, 'UNAVAILABLE', traceId); }
}
