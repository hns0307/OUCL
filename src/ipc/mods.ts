import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isModData, isModPayload, modFailure, ModContractError } from '../shared/contracts/mods.js';
import type { ModChannel, ModData, ModDispatcher, ModPayloads, ModResult } from '../shared/contracts/mods.js';
import type { ModTaskService } from '../services/mods/tasks.js';
import type { ModInstallPlanner } from '../services/mods/planner.js';

/** Checks the sender and exact envelope before dispatch, then validates every public result. */
export async function handleMods<C extends ModChannel>(channel: C, input: unknown, trusted: boolean, traceId: string,
  dispatch: ModDispatcher): Promise<ModResult<C>> {
  const valid = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = valid && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return modFailure(id, 'INVALID_SENDER', traceId);
  if (valid && typeof input.contractVersion === 'number' && input.contractVersion > 1) return modFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!valid || input.contractVersion !== 1 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId)
    || !isModPayload(input.payload, channel)) return modFailure(id, 'INVALID_ARGUMENT', traceId);
  try {
    const data = await dispatch(channel, input.payload, id);
    if (!isModData(data, channel)) throw new ModContractError('UNAVAILABLE');
    return { contractVersion: 1, requestId: id, ok: true, data };
  } catch (error) { return modFailure(id, error instanceof ModContractError ? error.code : 'UNAVAILABLE', traceId); }
}

/** Resolves only controlled instance/task identities; list and check share durable task admission. */
export function modDispatcher(service: Pick<ModTaskService, 'start' | 'report'>, planner?: Pick<ModInstallPlanner, 'plan'>): ModDispatcher {
  return async <C extends ModChannel>(channel: C, payload: ModPayloads[C], requestId: string): Promise<ModData[C]> => {
    let data: ModData[ModChannel];
    if (channel === 'mods:report' && isModPayload(payload, 'mods:report')) data = await service.report(payload.taskId);
    else if (channel === 'mods:plan' && isModPayload(payload, 'mods:plan') && planner) data = { plan: await planner.plan(payload) };
    else if (channel === 'mods:list' && isModPayload(payload, 'mods:list')) data = await service.start(requestId, 'list', payload);
    else if (channel === 'mods:check' && isModPayload(payload, 'mods:check')) data = await service.start(requestId, 'check', payload);
    else throw new ModContractError('INVALID_ARGUMENT');
    if (!isModData(data, channel)) throw new ModContractError('UNAVAILABLE');
    return data;
  };
}
