import type { OnlineToolsBridge, OnlineToolChannel, OnlineToolsResult } from '../shared/contracts/online-tools.js';
import { isOnlineToolPayload, isOnlineToolsResult, onlineToolFailure } from '../shared/contracts/online-tools.js';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';

interface Invoker { invoke(channel: string, input: unknown): Promise<unknown> }
/** A timeout does not cancel or retry a mutation; callers recover via the state method. */
export function createOnlineToolsBridge(ipc: Invoker): OnlineToolsBridge {
  async function request(channel: OnlineToolChannel, id: string, payload: unknown): Promise<OnlineToolsResult> {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id) || !isOnlineToolPayload(channel, payload)) return onlineToolFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply: unknown = await Promise.race([ipc.invoke(channel, { contractVersion: 1, requestId: id, payload }),
        new Promise(resolve => { timer = setTimeout(() => { resolve(onlineToolFailure(id, 'TIMEOUT', id)); }, 15000); })]);
      return isOnlineToolsResult(reply, id) ? reply : onlineToolFailure(id, 'UNAVAILABLE', id);
    } catch { return onlineToolFailure(id, 'UNAVAILABLE', id); }
    finally { clearTimeout(timer); }
  }
  return { onlineToolState: () => request('tools:state', globalThis.crypto.randomUUID(), {}),
    openOnlineTool: (id, toolId) => request('tools:open', id, { toolId }), retryOnlineTool: id => request('tools:retry', id, {}), closeOnlineTool: id => request('tools:close', id, {}) };
}
