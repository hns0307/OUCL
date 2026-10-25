import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isLoaderPayload, isLoaderResult, loaderFailure } from '../shared/contracts/loaders.js';
import type { LoaderChannel, LoaderPayloads, LoaderResult, LoadersBridge } from '../shared/contracts/loaders.js';

async function request<C extends LoaderChannel>(channel: C, payload: LoaderPayloads[C], requestId: string = crypto.randomUUID()): Promise<LoaderResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isLoaderPayload(payload, channel)) return loaderFailure(crypto.randomUUID(), 'INVALID_ARGUMENT', crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<LoaderResult<C>>(resolve => { timer = setTimeout(() => { resolve(loaderFailure(requestId, 'TIMEOUT', requestId)); }, 15000); });
    const value: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }), deadline]);
    return isLoaderResult(value, requestId, channel) ? value : loaderFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return loaderFailure(requestId, 'UNAVAILABLE', requestId); }
  finally { clearTimeout(timer); }
}

export function createLoadersBridge(): LoadersBridge {
  return { loaderVersions: input => request('loaders:versions', input),
    createLoaderInstance: (requestId, input) => request('loaders:create', input, requestId) };
}
