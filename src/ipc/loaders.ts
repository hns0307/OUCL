import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isLoaderData, isLoaderPayload, loaderFailure, LoaderContractError } from '../shared/contracts/loaders.js';
import type { LoaderChannel, LoaderDispatcher, LoaderResult } from '../shared/contracts/loaders.js';

/** Validates sender, exact v1 envelope and both adapter output and correlation before exposure. */
export async function handleLoaders<C extends LoaderChannel>(channel: C, input: unknown, trusted: boolean, traceId: string,
  dispatch: LoaderDispatcher): Promise<LoaderResult<C>> {
  const valid = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = valid && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return loaderFailure(id, 'INVALID_SENDER', traceId);
  if (valid && typeof input.contractVersion === 'number' && input.contractVersion > 1) return loaderFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!valid || input.contractVersion !== 1 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId)
    || !isLoaderPayload(input.payload, channel)) return loaderFailure(id, 'INVALID_ARGUMENT', traceId);
  try {
    const data = await dispatch(channel, input.payload, id);
    if (!isLoaderData(data, channel)) throw new LoaderContractError('UNAVAILABLE');
    return { contractVersion: 1, requestId: id, ok: true, data };
  } catch (error) { return loaderFailure(id, error instanceof LoaderContractError ? error.code : 'UNAVAILABLE', traceId); }
}
