import { DISTRIBUTION_EXECUTION_IPC_TIMEOUT_MS, distributionExecutionFailure,
  isDistributionExecutionRequest, isDistributionExecutionResult } from '../shared/contracts/distribution-execution.js';
import type { DistributionExecutionBridge, DistributionExecutionChannel, DistributionExecutionRequest,
  DistributionExecutionResult } from '../shared/contracts/distribution-execution.js';

interface Invoker { invoke(channel: string, input: unknown): Promise<unknown> }

/** Fixed-channel transport only. Timeout leaves execution outcome unknown: never retry or cancel implicitly. */
export function createDistributionExecutionBridge(ipc: Invoker, timeoutMs = DISTRIBUTION_EXECUTION_IPC_TIMEOUT_MS): DistributionExecutionBridge {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DISTRIBUTION_EXECUTION_IPC_TIMEOUT_MS) throw new RangeError('Invalid execution transport timeout');
  async function request<C extends DistributionExecutionChannel>(channel: C, id: string, payload: unknown): Promise<DistributionExecutionResult<C>> {
    let input: DistributionExecutionRequest<C>;
    try {
      const candidate: unknown = structuredClone({ contractVersion: 1, requestId: id, payload });
      if (!isDistributionExecutionRequest(candidate, channel)) throw new Error('Invalid request');
      input = candidate;
    } catch {
      const safeId = globalThis.crypto.randomUUID();
      return distributionExecutionFailure(safeId, 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value: unknown = await Promise.race([ipc.invoke(channel, structuredClone(input)), new Promise(resolve => {
        timer = setTimeout(() => resolve(distributionExecutionFailure(input.requestId, 'TIMEOUT', globalThis.crypto.randomUUID())), timeoutMs);
      })]);
      if (!isDistributionExecutionResult(value, input, channel)) return distributionExecutionFailure(input.requestId, 'UNAVAILABLE', globalThis.crypto.randomUUID());
      const detached: unknown = structuredClone(value);
      return isDistributionExecutionResult(detached, input, channel) ? detached : distributionExecutionFailure(input.requestId, 'UNAVAILABLE', globalThis.crypto.randomUUID());
    } catch { return distributionExecutionFailure(input.requestId, 'UNAVAILABLE', globalThis.crypto.randomUUID()); }
    finally { clearTimeout(timer); }
  }
  return {
    prepareDistributionExecution: (id, input) => request('distribution:prepareExecution', id, input),
    getDistributionExecutionPreparation: prepareRequestId => request('distribution:executionPreparation', globalThis.crypto.randomUUID(), { prepareRequestId }),
    cancelDistributionExecutionPreparation: prepareRequestId => request('distribution:cancelExecutionPreparation', globalThis.crypto.randomUUID(), { prepareRequestId }),
    confirmDistributionExecution: (id, input) => request('distribution:confirmExecution', id, input),
    recoverDistributionExecution: (id, taskId) => request('distribution:recoverExecution', id, { taskId }),
  };
}
