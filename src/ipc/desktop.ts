import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { desktopFailure, isDesktopData, isDesktopPayload } from '../shared/contracts/desktop.js';
import type { DesktopChannel, DesktopData, DesktopPayloads, DesktopResult } from '../shared/contracts/desktop.js';
import type { DesktopService } from '../services/desktop/service.js';
import { hasCode } from '../services/storage/files.js';

/** Validates sender and versioned envelope before any file chooser, image request or desktop mutation. */
export async function handleDesktop<C extends DesktopChannel>(channel: C, input: unknown, trusted: boolean, trace: string, service: DesktopService | undefined,
  chooseIcon: () => Promise<string>, resourceIcon: (id: string) => Promise<string>): Promise<DesktopResult<C>> {
  const shape = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = shape && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : trace;
  if (!trusted) return desktopFailure(id, 'INVALID_SENDER', trace);
  if (shape && typeof input.contractVersion === 'number' && input.contractVersion > 1) return desktopFailure(id, 'UNSUPPORTED_CONTRACT', trace);
  if (!shape || input.contractVersion !== 1 || !UUID_PATTERN.test(id) || id !== input.requestId || !isDesktopPayload(input.payload, channel)) return desktopFailure(id, 'INVALID_ARGUMENT', trace);
  if (!service) return desktopFailure(id, 'UNAVAILABLE', trace);
  try {
    const payload: DesktopPayloads[DesktopChannel] = input.payload; let data: DesktopData<DesktopChannel>;
    if (channel === 'desktop:appearance' && isDesktopPayload(payload, 'desktop:appearance')) data = await service.appearance(payload.expectedRevision, payload.appearance);
    else if (channel === 'desktop:saveDraft' && isDesktopPayload(payload, 'desktop:saveDraft')) data = await service.saveDraft(payload.expectedRevision, payload.draft);
    else if (channel === 'desktop:deleteDraft' && isDesktopPayload(payload, 'desktop:deleteDraft')) data = await service.deleteDraft(payload.expectedRevision, payload.id);
    else if (channel === 'desktop:chooseIcon') data = { icon: await chooseIcon() };
    else if (channel === 'desktop:resourceIcon' && isDesktopPayload(payload, 'desktop:resourceIcon')) data = { icon: await resourceIcon(payload.projectId) };
    else data = await service.get();
    if (!isDesktopData(data, channel)) return desktopFailure(id, 'UNAVAILABLE', trace);
    return { contractVersion: 1, requestId: id, ok: true, data };
  } catch (error) { return desktopFailure(id, hasCode(error, 'REVISION_CONFLICT') ? 'REVISION_CONFLICT' : 'UNAVAILABLE', trace); }
}
