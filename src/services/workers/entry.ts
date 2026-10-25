import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { RecordStore } from '../storage/records.js';
import { guardDirectory, StorageError } from '../storage/files.js';
import { parseStorageRequest, WorkerError } from './protocol.js';
import type { WorkerCode, WorkerReply } from './protocol.js';
import { ObjectIndex } from '../storage/object-index.js';
import { parseInstallation } from '../storage/installation.js';
import { parseCatalogCache } from '../storage/catalog-cache.js';
import { TransferDatabase } from '../storage/transfer-db.js';
import { digestFile, startHashSession } from './hash-session.js';
import { extractNativeArchives, NativeArchiveError } from '../install/native-archive.js';
import { parseNativeRequest } from './native-protocol.js';
import { instanceRecordId, parseInstanceIndex, parseInstanceRecord } from '../storage/instance-records.js';
import { parseLaunchProfiles } from '../storage/launch-profiles.js';
import { parseSettings } from '../storage/settings.js';
import { parseGameSessions } from '../storage/game-sessions.js';

const port = parentPort;
if (!port) throw new WorkerError('INVALID_MESSAGE');
const send = (value: WorkerReply): void => { port.postMessage(value); };
const code = (error: unknown): WorkerCode => error instanceof StorageError || error instanceof WorkerError ? error.code : 'WORKER_FAILED';

async function storage(directory: string): Promise<void> {
  const store = await RecordStore.open(directory);
  try { await store.recover(); } catch (error) { await store.close(); throw error; }
  let index: ObjectIndex | undefined;
  let transfers: TransferDatabase | undefined;
  let tail = Promise.resolve();
  let closing = false;
  port!.on('message', (input: unknown) => {
    tail = tail.then(async () => {
      let request;
      try { request = parseStorageRequest(input); }
      catch { send({ version: 1, kind: 'startup-failed', code: 'INVALID_MESSAGE' }); transfers?.close(); index?.close(); await store.close(); port!.close(); return; }
      if (closing) return;
      try {
        const command = request.command;
        let task;
        let object;
        let installation;
        let catalog;
        let transfer;
        let instances;
        let instance;
        let profiles;
        let sessions;
        let settings;
        if (command.kind === 'accept') task = await store.acceptTask(command.ownerId, command.requestId, command.taskKind, command.payloadDigest);
        else if (command.kind === 'get') task = await store.getTask(command.ownerId, command.taskId);
        else if (command.kind === 'update') task = await store.updateTask(command.ownerId, command.taskId, command.expectedRevision, command.execution);
        else if (command.kind === 'settings:get') settings = await store.read('launch-settings', parseSettings);
        else if (command.kind === 'settings:set') settings = await store.write('launch-settings', command.expectedRevision, command.data, parseSettings);
        else if (command.kind === 'sessions:get') sessions = await store.read('game-sessions', parseGameSessions);
        else if (command.kind === 'sessions:set') sessions = await store.write('game-sessions', command.expectedRevision, command.data, parseGameSessions);
        else if (command.kind === 'profiles:get') profiles = await store.read('launch-profiles', parseLaunchProfiles);
        else if (command.kind === 'profiles:set') profiles = await store.write('launch-profiles', command.expectedRevision, command.data, parseLaunchProfiles);
        else if (command.kind === 'installation:get') installation = await store.read('installation', parseInstallation);
        else if (command.kind === 'installation:set') installation = await store.write('installation', 0, command.data, parseInstallation);
        else if (command.kind === 'catalog:get') catalog = await store.read('catalog', parseCatalogCache);
        else if (command.kind === 'catalog:set') catalog = await store.write('catalog', command.expectedRevision, command.data, parseCatalogCache);
        else if (command.kind === 'instances:get') instances = await store.read('instances', parseInstanceIndex);
        else if (command.kind === 'instances:set') instances = await store.write('instances', command.expectedRevision, command.data, parseInstanceIndex);
        else if (command.kind === 'instance:get') {
          instance = await store.read(instanceRecordId(command.instanceId), parseInstanceRecord);
          if (instance && (instance.data.summary.instanceId !== command.instanceId.toLowerCase() || instance.data.summary.revision !== instance.revision)) throw new StorageError('NEEDS_RECOVERY');
        }
        else if (command.kind === 'instance:set') instance = await store.write(instanceRecordId(command.instanceId), command.expectedRevision, command.data, parseInstanceRecord);
        else if (command.kind === 'transfer:get' || command.kind === 'transfer:set') {
          await guardDirectory(directory); transfers ??= await TransferDatabase.open(directory, store);
          if (command.kind === 'transfer:get') transfer = transfers.get(command.key);
          else transfers.set(command.expectedRevision, command.record);
        }
        else if (command.kind === 'object:lookup' || command.kind === 'object:remember' || command.kind === 'object:clear') {
          await guardDirectory(directory);
          index ??= await ObjectIndex.open(directory);
          if (command.kind === 'object:lookup') object = index.lookup(command.sourceKey);
          else if (command.kind === 'object:remember') index.remember(command.sourceKey, command.object);
          else index.clear();
        } else { closing = true; transfers?.close(); index?.close(); await store.close(); }
        send({ version: 1, kind: 'response', id: request.id, ok: true, ...(task === undefined ? {} : { task }), ...(object === undefined ? {} : { object }),
          ...(installation === undefined ? {} : { installation }), ...(catalog === undefined ? {} : { catalog }), ...(transfer === undefined ? {} : { transfer }),
          ...(instances === undefined ? {} : { instances }), ...(instance === undefined ? {} : { instance }), ...(profiles === undefined ? {} : { profiles }), ...(sessions === undefined ? {} : { sessions }), ...(settings === undefined ? {} : { settings }) });
        if (closing) port!.close();
      } catch (error) { send({ version: 1, kind: 'response', id: request.id, ok: false, code: code(error) }); }
    }).catch(() => { send({ version: 1, kind: 'startup-failed', code: 'WORKER_FAILED' }); port!.close(); });
  });
  send({ version: 1, kind: 'ready' });
}

async function hashFile(file: string, maximumBytes: number): Promise<void> {
  const result = await digestFile(file, maximumBytes, (bytesDone, bytesTotal) => { send({ version: 1, kind: 'hash-progress', bytesDone, bytesTotal }); });
  send({ version: 1, kind: 'hash-result', result });
  port!.close();
}

void (async () => {
  const input: unknown = workerData;
  if (typeof input !== 'object' || input === null || !('version' in input) || input.version !== 1 || !('kind' in input)) throw new WorkerError('INVALID_MESSAGE');
  if (input.kind === 'native-extract') {
    try {
      let request;
      try { request = parseNativeRequest(input); } catch { throw new NativeArchiveError('INVALID_ARCHIVE'); }
      const result = await extractNativeArchives(request.destination, request.archives);
      port.postMessage({ version: 1, kind: 'native-result', ...result });
    } catch (error) { port.postMessage({ version: 1, kind: 'native-failed', code: error instanceof NativeArchiveError ? error.code : 'ARCHIVE_IO' }); }
    port.close();
  }
  else if (input.kind === 'storage' && Object.keys(input).sort().join(',') === 'directory,kind,version'
    && 'directory' in input && typeof input.directory === 'string') await storage(input.directory);
  else if (input.kind === 'hash-session' && Object.keys(input).sort().join(',') === 'kind,version') startHashSession(port);
  else if (input.kind === 'hash' && Object.keys(input).sort().join(',') === 'file,kind,maximumBytes,version'
    && 'file' in input && typeof input.file === 'string' && path.isAbsolute(input.file)
    && 'maximumBytes' in input && typeof input.maximumBytes === 'number' && Number.isSafeInteger(input.maximumBytes)
    && input.maximumBytes >= 0 && input.maximumBytes <= 64 * 1024 ** 3) await hashFile(input.file, input.maximumBytes);
  else throw new WorkerError('INVALID_MESSAGE');
})().catch(error => { send({ version: 1, kind: 'startup-failed', code: code(error) }); port.close(); });
