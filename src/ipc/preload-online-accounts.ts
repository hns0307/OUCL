
import { ipcRenderer } from 'electron';
import { isOnlineAccountsAction, isOnlineAccountsResult, ONLINE_ACCOUNTS_CHANNEL, onlineFailure } from '../shared/contracts/online-accounts.js';
import type { OnlineAccountsBridge, OnlineAccountsResult } from '../shared/contracts/online-accounts.js';

/** Validates the fixed account operation and matches the response to its originating request. */
export function createOnlineAccountsBridge(): OnlineAccountsBridge {
  return { onlineAccounts: async action => {
    const requestId = globalThis.crypto.randomUUID();
    if (!isOnlineAccountsAction(action)) return onlineFailure(requestId, 'INVALID_ARGUMENT');
    const timeout = action.kind === 'beginMicrosoft' ? 185_000 : action.kind === 'refreshMicrosoft' ? 95_000 : 12_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value: unknown = await Promise.race([
        ipcRenderer.invoke(ONLINE_ACCOUNTS_CHANNEL, { contractVersion: 1, requestId, action }),
        new Promise<OnlineAccountsResult>(resolve => { timer = setTimeout(() => { resolve(onlineFailure(requestId, 'TIMEOUT')); }, timeout); }),
      ]);
      return isOnlineAccountsResult(value, requestId) ? value : onlineFailure(requestId, 'UNAVAILABLE');
    } catch { return onlineFailure(requestId, 'UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  } };
}
