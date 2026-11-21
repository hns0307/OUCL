import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isProfileData, isProfilePayload, profileFailure, ProfileContractError } from '../shared/contracts/profiles.js';
import type { ProfileChannel, ProfileDispatcher, ProfileResult } from '../shared/contracts/profiles.js';

/** Authorizes the document and exact request before any native dialog, process or storage access. */
export async function handleProfiles<C extends ProfileChannel>(channel: C, input: unknown, trusted: boolean, traceId: string, dispatch: ProfileDispatcher): Promise<ProfileResult<C>> {
  const shape = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = shape && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return profileFailure(id, 'INVALID_SENDER', traceId);
  if (shape && typeof input.contractVersion === 'number' && input.contractVersion > 1) return profileFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!shape || input.contractVersion !== 1 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId) || !isProfilePayload(input.payload, channel)) return profileFailure(id, 'INVALID_ARGUMENT', traceId);
  try {
    const data = await dispatch(channel, input.payload, id);
    if (!isProfileData(data, channel)) return profileFailure(id, 'UNAVAILABLE', traceId);
    return { contractVersion: 1, requestId: id, ok: true, data };
  } catch (error) { return profileFailure(id, error instanceof ProfileContractError ? error.code : 'UNAVAILABLE', traceId); }
}
