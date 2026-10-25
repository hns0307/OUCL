import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isResourcePayload, isResourceResult, resourceFailure } from '../shared/contracts/resources.js';
import type { ResourceChannel, ResourcePayloads, ResourceResult, ResourcesBridge } from '../shared/contracts/resources.js';

async function request<C extends ResourceChannel>(channel: C, payload: ResourcePayloads[C], requestId: string, timeoutMs = 15000): Promise<ResourceResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isResourcePayload(payload, channel)) return resourceFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }), new Promise(resolve => {
      timer = setTimeout(() => { resolve(resourceFailure(requestId, 'TIMEOUT', requestId)); }, timeoutMs);
    })]);
    return isResourceResult(reply, requestId, channel) ? reply : resourceFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return resourceFailure(requestId, 'UNAVAILABLE', requestId); } finally { clearTimeout(timer); }
}
/** Five fixed methods; no arbitrary URL, path, channel or shell capability is exposed. */
export function createResourcesBridge(): ResourcesBridge {
  return { searchResources: input => request('resources:search', input, globalThis.crypto.randomUUID()),
    resourceVersions: input => request('resources:versions', input, globalThis.crypto.randomUUID()), downloadResource: (id, input) => request('resources:download', input, id),
    resourceLibrary: () => request('resources:library', {}, globalThis.crypto.randomUUID(), 5000), openResourceLibrary: () => request('resources:open', {}, globalThis.crypto.randomUUID(), 5000) };
}
