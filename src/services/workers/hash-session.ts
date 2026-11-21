import type { MessagePort } from 'node:worker_threads';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { guardDirectory, StorageError } from '../storage/files.js';
import { parseHashJobRequest, WorkerError } from './protocol.js';
import type { HashResult, WorkerCode, WorkerReply } from './protocol.js';

/** Computes a bounded digest and closes the file handle before resolving any job result. */
export async function digestFile(file: string, maximumBytes: number, progress: (done: number, total: number) => void): Promise<HashResult> {
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
      if (performance.now() - lastProgress >= 100) { progress(size, original.size); lastProgress = performance.now(); }
    }
    const final = await handle.stat();
    if (size !== original.size || final.size !== original.size || final.mtimeMs !== original.mtimeMs) throw new WorkerError('NEEDS_RECOVERY');
    return { size, sha1: sha1.digest('hex'), sha256: sha256.digest('hex') };
  } finally { await handle.close(); }
}

/** Installs a sequential private hash-only session; every job and reply retains its UUID. */
export function startHashSession(port: MessagePort): void {
  let active = false; let stopped = false;
  const send = (value: WorkerReply): void => { if (!stopped) port.postMessage(value); };
  const failureCode = (error: unknown): WorkerCode => error instanceof WorkerError || error instanceof StorageError ? error.code : 'WORKER_FAILED';
  port.on('message', (input: unknown) => {
    if (stopped) return;
    let request;
    try { request = parseHashJobRequest(input); if (active) throw new WorkerError('INVALID_MESSAGE'); }
    catch { send({ version: 1, kind: 'startup-failed', code: 'INVALID_MESSAGE' }); stopped = true; port.close(); return; }
    active = true;
    const { jobId } = request;
    void digestFile(request.file, request.maximumBytes, (bytesDone, bytesTotal) => {
      send({ version: 1, kind: 'hash-job-progress', jobId, bytesDone, bytesTotal });
    }).then(result => {
      active = false; send({ version: 1, kind: 'hash-job-result', jobId, result });
    }).catch(error => {
      active = false; send({ version: 1, kind: 'hash-job-failed', jobId, code: failureCode(error) });
    });
  });
  send({ version: 1, kind: 'hash-ready' });
}
