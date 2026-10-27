import type { IpcRenderer } from 'electron';
import { INSTANCE_FOLDER_CHANNEL, instanceFolderFailure, isInstanceFolderResult } from '../shared/contracts/instance-folders.js';
import type { InstanceFolderKind, InstanceFolderResult, InstanceFoldersBridge } from '../shared/contracts/instance-folders.js';
export function createInstanceFoldersBridge(ipcRenderer: IpcRenderer): InstanceFoldersBridge {
  return { async openInstanceFolder(instanceId: string, folder: InstanceFolderKind): Promise<InstanceFolderResult> {
    const requestId = globalThis.crypto.randomUUID();
    try {
      const value: unknown = await ipcRenderer.invoke(INSTANCE_FOLDER_CHANNEL, { contractVersion: 1, requestId, payload: { instanceId, folder } });
      return isInstanceFolderResult(value, requestId) ? value : instanceFolderFailure(requestId, 'UNAVAILABLE', requestId);
    } catch { return instanceFolderFailure(requestId, 'UNAVAILABLE', requestId); }
  } };
}
