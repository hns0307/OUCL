import { isWebAction, isWebResult, WEB_EXTENSIONS_CHANNEL, webFailure } from '../shared/contracts/web-extensions.js';
import type { WebExtensionsBridge } from '../shared/contracts/web-extensions.js';

interface Invoker { invoke(channel: string, input: unknown): Promise<unknown> }

/** Sends exact DTOs through the existing launcher preload. */
export function createWebExtensionsBridge(ipc: Invoker): WebExtensionsBridge {
  return {
    async webExtensions(action) {
      const id = globalThis.crypto.randomUUID();
      if (!isWebAction(action)) return webFailure(id, 'INVALID_ARGUMENT');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const reply = await Promise.race([
          ipc.invoke(WEB_EXTENSIONS_CHANNEL, { contractVersion: 1, requestId: id, action }),
          new Promise(resolve => { timer = setTimeout(() => { resolve(webFailure(id, 'TIMEOUT')); }, 20000); }),
        ]);
        return isWebResult(reply, id) ? reply : webFailure(id, 'UNAVAILABLE');
      } catch { return webFailure(id, 'UNAVAILABLE'); }
      finally { clearTimeout(timer); }
    },
  };
}
