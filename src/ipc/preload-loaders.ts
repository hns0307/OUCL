import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isLoaderPayload, isLoaderResult, loaderFailure } from '../shared/contracts/loaders.js';
import type { LoaderChannel, LoaderPayloads, LoaderResult, LoadersBridge } from '../shared/contracts/loaders.js';

async function request<C extends LoaderChannel>(channel: C, payload: LoaderPayloads[C], requestId: string = crypto.randomUUID()): Promise<LoaderResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isLoaderPayload(payload, channel)) return loaderFailure(crypto.randomUUID(), 'INVALID_ARGUMENT', crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Catalog reads can consume three 12-second transport attempts plus bounded backoff.
    // Creating an instance keeps its existing admission deadline; no write is replayed here.
    const timeoutMs = channel === 'loaders:versions' ? 45000 : 15000;
    const deadline = new Promise<LoaderResult<C>>(resolve => { timer = setTimeout(() => { resolve(loaderFailure(requestId, 'TIMEOUT', requestId)); }, timeoutMs); });
    const value: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }), deadline]);
    return isLoaderResult(value, requestId, channel) ? value : loaderFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return loaderFailure(requestId, 'UNAVAILABLE', requestId); }
  finally { clearTimeout(timer); }
}

export function createLoadersBridge(): LoadersBridge {
  return { loaderVersions: input => request('loaders:versions', input),
    createLoaderInstance: (requestId, input) => request('loaders:create', input, requestId) };
}
