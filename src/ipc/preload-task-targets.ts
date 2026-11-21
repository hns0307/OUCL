import { ipcRenderer } from 'electron';
import { instanceFailure } from '../shared/contracts/instances.js';
import { isTargetQuery, isTargetResult, TARGET_CHANNEL } from '../shared/contracts/task-targets.js';
import type { TargetBridge, TargetCode, TargetResult } from '../shared/contracts/task-targets.js';

function failure(requestId: string, code: TargetCode): TargetResult {
  const result = instanceFailure(requestId, code, requestId);
  if (result.ok) throw new Error('UNREACHABLE');
  return { ...result, error: { ...result.error, code } };
}
/** Exposes a fixed, read-only target query with a bounded observation deadline. */
export function createTargetBridge(): TargetBridge {
  return { async listInstanceTaskTargets(payload) {
    const requestId = crypto.randomUUID();
    if (!isTargetQuery(payload)) return failure(requestId, 'INVALID_ARGUMENT');
    const request = { contractVersion: 1 as const, requestId, payload };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<TargetResult>(resolve => { timer = setTimeout(() => { resolve(failure(requestId, 'TIMEOUT')); }, 3000); });
      const reply: unknown = await Promise.race([ipcRenderer.invoke(TARGET_CHANNEL, request), timeout]);
      return isTargetResult(reply, request) ? reply : failure(requestId, 'UNAVAILABLE');
    } catch { return failure(requestId, 'UNAVAILABLE'); } finally { clearTimeout(timer); }
  } };
}
