import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isMultiplayerInput, isMultiplayerRequest, MULTIPLAYER_CHANNEL } from '../shared/contracts/multiplayer.js';
import type { MultiplayerResult } from '../shared/contracts/multiplayer.js';
import { MultiplayerService } from '../services/multiplayer/service.js';
import type { MultiplayerDependencies } from '../services/multiplayer/service.js';
import { RoomError } from '../services/multiplayer/config.js';
import { MULTIPLAYER_MESSAGES as copy } from '../shared/locales/multiplayer-messages.js';

/** Assembles the game-scoped room service with launcher-owned dependencies. */
export function createMultiplayerService(dependencies: MultiplayerDependencies): MultiplayerService {
  return new MultiplayerService(dependencies);
}

/** Registers a single validated primary-frame IPC boundary for room and setup operations. */
export function registerMultiplayerIpc(getService: () => MultiplayerService | undefined, trusted: (event: IpcMainInvokeEvent) => boolean): void {
  let selecting = false;
  ipcMain.handle(MULTIPLAYER_CHANNEL, async (event, input: unknown): Promise<MultiplayerResult> => {
    const traceId = randomUUID();
    const envelope = exactObject(input, ['contractVersion', 'requestId', 'payload']) ? input : undefined;
    const requestId = typeof envelope?.requestId === 'string' && UUID_PATTERN.test(envelope.requestId) ? envelope.requestId : traceId;
    try {
      if (!trusted(event)) throw new RoomError('INVALID_SENDER');
      if (envelope && envelope.contractVersion !== 1 && isMultiplayerInput(envelope.payload)) throw new RoomError('UNSUPPORTED_CONTRACT');
      if (!isMultiplayerRequest(input)) throw new RoomError('INVALID_ARGUMENT');
      const service = getService();
      if (!service) throw new RoomError('UNAVAILABLE');
      const request = input.payload;
      let invite: string | undefined;
      switch (request.action) {
        case 'snapshot': break;
        case 'host': service.host(request.sessionId, request.port); break;
        case 'join': service.join(request.invite); break;
        case 'leave': await service.leave(); break;
        case 'configure': await service.configure(request.relay); break;
        case 'invite': invite = service.invite(); break;
        case 'importEngine': {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (!window || selecting) throw new RoomError('ROOM_BUSY');
          selecting = true;
          try {
            const result = await dialog.showOpenDialog(window, {
              title: copy.engineDialog,
              properties: ['openFile'],
              filters: [{ name: 'ZIP', extensions: ['zip'] }],
            });
            if (!trusted(event)) throw new RoomError('INVALID_SENDER');
            const file = result.filePaths[0];
            if (result.canceled || !file) throw new RoomError('CANCELLED');
            await service.importEngine(file);
          } finally {
            selecting = false;
          }
          break;
        }
      }
      return { contractVersion: 1, requestId, ok: true, data: await service.snapshot(), ...(invite ? { invite } : {}) };
    } catch (error) {
      return { contractVersion: 1, requestId, ok: false, error: { code: error instanceof RoomError ? error.code : 'UNAVAILABLE', traceId } };
    }
  });
}
