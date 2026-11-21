import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isPreviewPayload, isPreviewResult, previewFailure } from '../shared/contracts/mod-maintenance-preview.js';
import type { MaintenancePreviewBridge, PreviewChannel, PreviewPayloads, PreviewResult } from '../shared/contracts/mod-maintenance-preview.js';

async function request<C extends PreviewChannel>(channel: C, payload: PreviewPayloads[C], requestId: string = crypto.randomUUID()): Promise<PreviewResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isPreviewPayload(payload, channel)) return previewFailure(crypto.randomUUID(), 'INVALID_ARGUMENT', crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<PreviewResult<C>>(resolve => { timer = setTimeout(() => { resolve(previewFailure(requestId, 'TIMEOUT', requestId)); }, 3000); });
    const reply: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }), timeout]);
    if (!isPreviewResult(reply, requestId, channel)) return previewFailure(requestId, 'UNAVAILABLE', requestId);
    if (channel !== 'mods:maintenancePreview' && reply.ok && isPreviewPayload(payload, 'mods:maintenancePreviewStatus')
      && reply.data.previewId.toLowerCase() !== payload.previewId.toLowerCase()) return previewFailure(requestId, 'UNAVAILABLE', requestId);
    return reply;
  } catch { return previewFailure(requestId, 'UNAVAILABLE', requestId); }
  finally { clearTimeout(timer); }
}
/** Exposes only the three bounded, read-only operations. */
export function createMaintenancePreviewBridge(): MaintenancePreviewBridge {
  return { maintenancePreview: (requestId, input) => request('mods:maintenancePreview', input, requestId),
    maintenancePreviewStatus: previewId => request('mods:maintenancePreviewStatus', { previewId }),
    maintenancePreviewCancel: previewId => request('mods:maintenancePreviewCancel', { previewId }) };
}
