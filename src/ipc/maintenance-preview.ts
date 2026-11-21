import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isModCode } from '../shared/contracts/mods.js';
import { isPreviewData, isPreviewPayload, previewFailure } from '../shared/contracts/mod-maintenance-preview.js';
import type { PreviewChannel, PreviewData, PreviewPayloads, PreviewResult } from '../shared/contracts/mod-maintenance-preview.js';
import type { MaintenancePreviewJobs } from '../services/mods/maintenance-jobs.js';

/** Rejects untrusted callers and malformed envelopes before touching the observation registry. */
export async function handleMaintenancePreview<C extends PreviewChannel>(channel: C, input: unknown, trusted: boolean, traceId: string,
  jobs: Pick<MaintenancePreviewJobs, 'start' | 'get' | 'cancel'> | undefined): Promise<PreviewResult<C>> {
  const envelope = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const requestId = envelope && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return previewFailure(requestId, 'INVALID_SENDER', traceId);
  if (envelope && typeof input.contractVersion === 'number' && input.contractVersion > 1) return previewFailure(requestId, 'UNSUPPORTED_CONTRACT', traceId);
  if (!envelope || input.contractVersion !== 1 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId)
    || !isPreviewPayload(input.payload, channel)) return previewFailure(requestId, 'INVALID_ARGUMENT', traceId);
  if (!jobs) return previewFailure(requestId, 'UNAVAILABLE', traceId);
  try {
    const payload: PreviewPayloads[PreviewChannel] = input.payload;
    let result: PreviewData[PreviewChannel];
    if (channel === 'mods:maintenancePreview' && isPreviewPayload(payload, 'mods:maintenancePreview')) result = jobs.start(requestId, payload);
    else if (channel === 'mods:maintenancePreviewStatus' && isPreviewPayload(payload, 'mods:maintenancePreviewStatus')) result = jobs.get(payload.previewId);
    else if (channel === 'mods:maintenancePreviewCancel' && isPreviewPayload(payload, 'mods:maintenancePreviewCancel')) result = await jobs.cancel(payload.previewId);
    else return previewFailure(requestId, 'INVALID_ARGUMENT', traceId);
    if (!isPreviewData(result, channel)) return previewFailure(requestId, 'UNAVAILABLE', traceId);
    return { contractVersion: 1, requestId, ok: true, data: result as PreviewData[C] };
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    return previewFailure(requestId, errorCode === 'PREVIEW_EXPIRED' ? errorCode : isModCode(errorCode) ? errorCode : 'UNAVAILABLE', traceId);
  }
}
