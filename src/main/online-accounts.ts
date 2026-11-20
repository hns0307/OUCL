
import { ipcMain, nativeImage } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isOnlineAccountsAction, isOnlineAccountsData, ONLINE_ACCOUNTS_CHANNEL, onlineFailure } from '../shared/contracts/online-accounts.js';
import type { OnlineAccountSummary, OnlineAccountsData } from '../shared/contracts/online-accounts.js';
import type { MicrosoftAccounts } from '../services/auth/microsoft-accounts.js';
import { MicrosoftError, officialTexture } from '../services/auth/microsoft-api.js';

const MAX_PNG = 280 * 1024;

async function texture(url: string, fetcher: typeof fetch): Promise<string | undefined> {
  if (officialTexture(url) !== url) return;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const reader = response.body?.getReader();
    if (!reader) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (!response.ok) return;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_PNG) return;
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (size < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 512 || height > 512) return;
    const image = nativeImage.createFromBuffer(bytes);
    const png = image.toPNG();
    if (!image.isEmpty() && png.length <= MAX_PNG) return 'data:image/png;base64,' + png.toString('base64');
  } catch { return; }
}

/** Routes only trusted top-level launcher requests and returns public snapshots or sanitized texture bytes. */
export function registerOnlineAccounts(trusted: (event: IpcMainInvokeEvent) => boolean, accounts: () => MicrosoftAccounts | undefined,
  skinAccounts: () => Promise<OnlineAccountSummary[]>, fetcher: () => typeof fetch | undefined): void {
  ipcMain.handle(ONLINE_ACCOUNTS_CHANNEL, async (event, input: unknown) => {
    const hasEnvelope = exactObject(input, ['contractVersion', 'requestId', 'action']);
    const requestId = hasEnvelope && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : randomUUID();
    if (!trusted(event)) return onlineFailure(requestId, 'INVALID_SENDER');
    if (hasEnvelope && typeof input.contractVersion === 'number' && input.contractVersion > 1) return onlineFailure(requestId, 'UNSUPPORTED_CONTRACT');
    if (!hasEnvelope || input.contractVersion !== 1 || input.requestId !== requestId || !isOnlineAccountsAction(input.action)) {
      return onlineFailure(requestId, 'INVALID_ARGUMENT');
    }
    const service = accounts();
    if (!service) return onlineFailure(requestId, 'UNAVAILABLE');
    const action = input.action;
    try {
      let data: OnlineAccountsData;
      if (action.kind === 'textures' && 'accountId' in action) {
        const profile = await service.profile(action.accountId);
        const network = fetcher();
        const [skin, cape] = profile && network
          ? await Promise.all([profile.skin && texture(profile.skin.url, network), profile.cape && texture(profile.cape, network)]) : [];
        data = { kind: 'textures', ...(skin ? { skin, model: profile?.skin?.model ?? 'classic' } : {}), ...(cape ? { cape } : {}) };
      } else {
        if (action.kind === 'beginMicrosoft') await service.signIn();
        else if (action.kind === 'cancelMicrosoft') service.cancelSignIn();
        else if (action.kind === 'refreshMicrosoft' && 'accountId' in action) await service.updateAccount(action.accountId);
        else if (action.kind === 'removeMicrosoft' && 'accountId' in action) await service.signOut(action.accountId);
        const microsoft = await service.list().catch(error => {
          if (action.kind !== 'list') throw error;
          return [];
        });
        const items = await skinAccounts().catch(() => []);
        data = { kind: 'accounts', microsoftConfigured: service.configured,
          items: [...microsoft.map((item): OnlineAccountSummary => ({ ...item, kind: 'microsoft', displayName: item.gameName || 'Microsoft' })), ...items] };
      }
      if (!trusted(event)) return onlineFailure(requestId, 'INVALID_SENDER');
      return isOnlineAccountsData(data) ? { contractVersion: 1, requestId, ok: true, data } : onlineFailure(requestId, 'UNAVAILABLE');
    } catch (error) { return onlineFailure(requestId, error instanceof MicrosoftError ? error.code : 'UNAVAILABLE'); }
  });
}
