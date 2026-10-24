import { parentPort, workerData } from 'node:worker_threads';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { RecordStore } from '../storage/records.js';
import { guardDirectory, StorageError } from '../storage/files.js';
import { parseStorageRequest, WorkerError } from './protocol.js';
import type { WorkerCode, WorkerReply } from './protocol.js';
import { ObjectIndex } from '../storage/object-index.js';

const port = parentPort;
if (!port) throw new WorkerError('INVALID_MESSAGE');
const send = (value: WorkerReply): void => { port.postMessage(value); };
const code = (error: unknown): WorkerCode => error instanceof StorageError || error instanceof WorkerError ? error.code : 'WORKER_FAILED';

async function storage(directory: string): Promise<void> {
  const store = await RecordStore.open(directory);
  try { await store.recover(); } catch (error) { await store.close(); throw error; }
  let index: ObjectIndex | undefined;
  let tail = Promise.resolve();
  let closing = false;
  port!.on('message', (input: unknown) => {
    tail = tail.then(async () => {
      let request;
      try { request = parseStorageRequest(input); }
      catch { send({ version: 1, kind: 'startup-failed', code: 'INVALID_MESSAGE' }); index?.close(); await store.close(); port!.close(); return; }
      if (closing) return;
      try {
        const command = request.command;
        let task;
        let object;
        if (command.kind === 'accept') task = await store.acceptTask(command.ownerId, command.requestId, command.taskKind, command.payloadDigest);
        else if (command.kind === 'get') task = await store.getTask(command.ownerId, command.taskId);
        else if (command.kind === 'update') task = await store.updateTask(command.ownerId, command.taskId, command.expectedRevision, command.execution);
        else if (command.kind === 'object:lookup' || command.kind === 'object:remember' || command.kind === 'object:clear') {
          await guardDirectory(directory);
          index ??= await ObjectIndex.open(directory);
          if (command.kind === 'object:lookup') object = index.lookup(command.sourceKey);
          else if (command.kind === 'object:remember') index.remember(command.sourceKey, command.object);
          else index.clear();
        } else { closing = true; index?.close(); await store.close(); }
        send({ version: 1, kind: 'response', id: request.id, ok: true, ...(task === undefined ? {} : { task }), ...(object === undefined ? {} : { object }) });
        if (closing) port!.close();
      } catch (error) { send({ version: 1, kind: 'response', id: request.id, ok: false, code: code(error) }); }
    }).catch(() => { send({ version: 1, kind: 'startup-failed', code: 'WORKER_FAILED' }); port!.close(); });
  });
  send({ version: 1, kind: 'ready' });
}

async function hashFile(file: string, maximumBytes: number): Promise<void> {
  await guardDirectory(path.dirname(file));
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new WorkerError('UNSAFE_PATH');
  if (info.size > maximumBytes) throw new WorkerError('FILE_TOO_LARGE');
  const handle = await open(file, 'r');
  try {
    const original = await handle.stat();
    if (original.dev !== info.dev || original.ino !== info.ino || original.size !== info.size || !original.isFile()) throw new WorkerError('UNSAFE_PATH');
    const sha1 = createHash('sha1'); const sha256 = createHash('sha256');
    let size = 0; let lastProgress = -Infinity;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      if (size > maximumBytes || size > original.size) throw new WorkerError('FILE_TOO_LARGE');
      sha1.update(bytes); sha256.update(bytes);
      if (performance.now() - lastProgress >= 100) {
        send({ version: 1, kind: 'hash-progress', bytesDone: size, bytesTotal: original.size }); lastProgress = performance.now();
      }
    }
    const final = await handle.stat();
    if (size !== original.size || final.size !== original.size || final.mtimeMs !== original.mtimeMs) throw new WorkerError('NEEDS_RECOVERY');
    send({ version: 1, kind: 'hash-result', result: { size, sha1: sha1.digest('hex'), sha256: sha256.digest('hex') } });
  } finally { await handle.close(); }
  port!.close();
}

void (async () => {
  const input: unknown = workerData;
  if (typeof input !== 'object' || input === null || !('version' in input) || input.version !== 1 || !('kind' in input)) throw new WorkerError('INVALID_MESSAGE');
  if (input.kind === 'storage' && Object.keys(input).sort().join(',') === 'directory,kind,version'
    && 'directory' in input && typeof input.directory === 'string') await storage(input.directory);
  else if (input.kind === 'hash' && Object.keys(input).sort().join(',') === 'file,kind,maximumBytes,version'
    && 'file' in input && typeof input.file === 'string' && path.isAbsolute(input.file)
    && 'maximumBytes' in input && typeof input.maximumBytes === 'number' && Number.isSafeInteger(input.maximumBytes)
    && input.maximumBytes >= 0 && input.maximumBytes <= 64 * 1024 ** 3) await hashFile(input.file, input.maximumBytes);
  else throw new WorkerError('INVALID_MESSAGE');
})().catch(error => { send({ version: 1, kind: 'startup-failed', code: code(error) }); port.close(); });
