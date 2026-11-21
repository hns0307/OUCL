import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { INSTANCES_V2_LIST_CHANNEL, instancesV2Failure, isInstancesV2Result } from '../shared/contracts/instances-v2.js';
import type { InstancesV2Bridge, InstancesV2Result } from '../shared/contracts/instances-v2.js';

export function createInstancesV2Bridge(): InstancesV2Bridge {
  return { async listInstancesV2(rootId: string): Promise<InstancesV2Result> {
    const requestId = crypto.randomUUID();
    if (!UUID_PATTERN.test(rootId)) return instancesV2Failure(requestId, 'INVALID_ARGUMENT', requestId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<InstancesV2Result>(resolve => { timer = setTimeout(() => { resolve(instancesV2Failure(requestId, 'TIMEOUT', requestId)); }, 3000); });
      const value: unknown = await Promise.race([ipcRenderer.invoke(INSTANCES_V2_LIST_CHANNEL, { contractVersion: 2, requestId, payload: { rootId } }), deadline]);
      return isInstancesV2Result(value, requestId) ? value : instancesV2Failure(requestId, 'UNAVAILABLE', requestId);
    } catch { return instancesV2Failure(requestId, 'UNAVAILABLE', requestId); } finally { clearTimeout(timer); }
  } };
}
