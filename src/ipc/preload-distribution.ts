import { distributionFailure, isDistributionQuery, isDistributionResult } from '../shared/contracts/distribution-preview.js';
import type { DistributionBridge, DistributionChannel, DistributionResult } from '../shared/contracts/distribution-preview.js';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';

interface Invoker { invoke(channel: string, input: unknown): Promise<unknown> }
/** No implicit preview retry on timeout. Same request ID queries the same read-only job. */
export function createDistributionBridge(ipc: Invoker): DistributionBridge {
  async function request(channel: DistributionChannel, id: string, payload: unknown): Promise<DistributionResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value: unknown = await Promise.race([ipc.invoke(channel, { contractVersion: 1, requestId: id, payload }),
        new Promise(resolve => { timer = setTimeout(() => { resolve(distributionFailure(id, 'TIMEOUT', id)); }, channel === 'distribution:sources' ? 3000 : 45000); })]);
      return isDistributionResult(value, id, channel) ? value : distributionFailure(id, 'UNAVAILABLE', id);
    } catch { return distributionFailure(id, 'UNAVAILABLE', id); }
    finally { clearTimeout(timer); }
  }
  return { distributionSources: () => request('distribution:sources', globalThis.crypto.randomUUID(), {}),
    previewDistribution: (id, query) => typeof id === 'string' && UUID_PATTERN.test(id) && isDistributionQuery(query) ? request('distribution:preview', id, query)
      : Promise.resolve(distributionFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID())),
    cancelDistributionPreview: previewRequestId => typeof previewRequestId === 'string' && UUID_PATTERN.test(previewRequestId) ? request('distribution:cancel', globalThis.crypto.randomUUID(), { previewRequestId })
      : Promise.resolve(distributionFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID())) };
}
