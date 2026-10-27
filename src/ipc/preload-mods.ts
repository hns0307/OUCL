import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isModPayload, isModResult, modFailure } from '../shared/contracts/mods.js';
import type { ModChannel, ModPayloads, ModResult, ModsBridge } from '../shared/contracts/mods.js';

async function request<C extends ModChannel>(channel: C, payload: ModPayloads[C], requestId: string = crypto.randomUUID()): Promise<ModResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isModPayload(payload, channel)) return modFailure(crypto.randomUUID(), 'INVALID_ARGUMENT', crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<ModResult<C>>(resolve => { timer = setTimeout(() => { resolve(modFailure(requestId, 'TIMEOUT', requestId)); }, channel === 'mods:plan' ? 35000 : 15000); });
    const value: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }), deadline]);
    return isModResult(value, requestId, channel) ? value : modFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return modFailure(requestId, 'UNAVAILABLE', requestId); }
  finally { clearTimeout(timer); }
}

/** Exposes fixed Mod operations, with cancellation and subscriptions supplied by tasks.v1. */
export function createModsBridge(): ModsBridge {
  return { listMods: (id, input) => request('mods:list', input, id), checkMods: (id, input) => request('mods:check', input, id),
    modReport: taskId => request('mods:report', { taskId }), planMod: (id, input) => request('mods:plan', input, id) };
}
