import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { guardDirectory, hasCode } from '../storage/files.js';
import { DownloadError, parseTransferRecord } from './types.js';
import type { TransferCheckpoint, TransferOptions, TransferRecord } from './types.js';

interface Timeouts { headersMs?: number; idleMs?: number }
interface Validators { etag?: string; lastModified?: string }
const CHECKPOINT_BYTES = 1024 * 1024;

function diskError(error: unknown): DownloadError {
  if (error instanceof DownloadError) return error;
  if (hasCode(error, 'ENOSPC')) return new DownloadError('DISK_FULL');
  if (hasCode(error, 'UNSAFE_PATH') || hasCode(error, 'ENOENT')) return new DownloadError('NEEDS_RECOVERY');
  if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM')) return new DownloadError('DISK_PERMISSION');
  return new DownloadError('TRANSFER_IO');
}
function validators(response: Response): Validators {
  const etag = response.headers.get('etag'); const modified = response.headers.get('last-modified');
  if (etag !== null && /^"[\x21\x23-\x7e]{0,180}"$/.test(etag)) return { etag };
  if (modified !== null && modified.length <= 80 && Number.isFinite(Date.parse(modified)) && new Date(modified).toUTCString() === modified) return { lastModified: modified };
  return {};
}
function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (value === null || value.length > 80) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 24 * 60 * 60 * 1000) : undefined;
}
function contentLength(response: Response): number | undefined {
  const text = response.headers.get('content-length');
  if (text === null) return undefined;
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new DownloadError('BAD_RESPONSE');
  return Number(text);
}
async function writableStaging(file: string, bytesDone: number): Promise<FileHandle> {
  try {
    await guardDirectory(path.dirname(file)); const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < bytesDone) throw new DownloadError('NEEDS_RECOVERY');
    const handle = await open(file, 'r+');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size < bytesDone) throw new DownloadError('NEEDS_RECOVERY');
      if (opened.size > bytesDone) { await handle.truncate(bytesDone); await handle.sync(); }
      return handle;
    } catch (error) { await handle.close(); throw error; }
  } catch (error) { throw diskError(error); }
}
async function closeStaging(handle: FileHandle): Promise<void> {
  try { await handle.close(); } catch (error) { throw diskError(error); }
}

/** One physical first-party download. Consumers, final content hashing and object commits belong to the coordinator. */
export class HttpTransfer {
  private readonly headersMs: number;
  private readonly idleMs: number;
  constructor(private readonly request: typeof fetch = fetch, timeouts: Timeouts = {}) {
    this.headersMs = timeouts.headersMs ?? 15000; this.idleMs = timeouts.idleMs ?? 30000;
    for (const value of [this.headersMs, this.idleMs]) if (!Number.isSafeInteger(value) || value < 1 || value > 120000) throw new DownloadError('INVALID_TRANSFER');
  }

  /** Writes only to an already allocated staging file; fsync precedes every durable progress checkpoint. */
  async run(file: string, record: TransferRecord, checkpoint: TransferCheckpoint, options: TransferOptions = {}): Promise<TransferRecord> {
    let current = parseTransferRecord(record);
    if (current.state === 'committed') throw new DownloadError('INVALID_TRANSFER');
    if (options.signal?.aborted) throw new DownloadError('CANCELLED');
    const handle = await writableStaging(file, current.bytesDone);
    let position = current.bytesDone; let journalFailed = false;
    const save = async (changes: Partial<TransferRecord>, clearValidators = false): Promise<void> => {
      try { await handle.sync(); } catch (error) { throw diskError(error); }
      const next: TransferRecord = { ...current };
      if (clearValidators) { delete next.etag; delete next.lastModified; }
      Object.assign(next, changes); next.revision = current.revision + 1;
      const validated = parseTransferRecord(next);
      try { await checkpoint(current.revision, validated); }
      catch { journalFailed = true; throw new DownloadError('NEEDS_RECOVERY'); }
      current = validated;
    };
    const reset = async (): Promise<void> => {
      // Commit the smaller valid prefix before discarding the old tail; never claim bytes that were truncated.
      await save({ bytesDone: 0, state: 'partial' }, true);
      position = 0;
      try { await handle.truncate(0); await handle.sync(); } catch (error) { throw diskError(error); }
    };
    try {
      if (current.state === 'complete') return current;
      if (position > 0 && !current.etag && !current.lastModified) await reset();
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController(); let timedOut = false;
        let timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.headersMs);
        const cancel = (): void => { controller.abort(); };
        options.signal?.addEventListener('abort', cancel, { once: true });
        if (options.signal?.aborted) controller.abort();
        let response: Response | undefined;
        try {
          const headers: Record<string, string> = { 'accept-encoding': 'identity' };
          const offset = position;
          const validator = current.etag ?? current.lastModified;
          if (offset > 0 && validator) { headers.range = `bytes=${offset}-`; headers['if-range'] = validator; }
          response = await this.request(current.url, { headers, signal: controller.signal, redirect: 'error', credentials: 'omit' });
          clearTimeout(timer);
          if (options.signal?.aborted) throw new DownloadError('CANCELLED');
          if (response.status === 429 || response.status === 503) throw new DownloadError('RETRY_LATER', retryAfter(response));
          const encoding = response.headers.get('content-encoding');
          if (encoding !== null && encoding.toLowerCase() !== 'identity') throw new DownloadError('BAD_RESPONSE');
          let badRange = false;
          let end = current.expected.size;
          if (response.status === 416) {
            const total = /^bytes \*\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
            if (offset === current.expected.size && total && Number(total[1]) === current.expected.size) {
              await save({ bytesDone: position, state: 'complete' }); return current;
            }
            badRange = true;
          } else if (response.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
            const begin = Number(range?.[1]); const last = Number(range?.[2]); const total = Number(range?.[3]);
            const receivedValidator = validators(response);
            badRange = offset === 0 || !range || ![begin, last, total].every(Number.isSafeInteger) || begin !== offset
              || last < begin || last >= total || total !== current.expected.size
              || current.etag !== undefined && receivedValidator.etag !== current.etag
              || current.etag === undefined && current.lastModified !== undefined && response.headers.get('last-modified') !== current.lastModified;
            if (!badRange) {
              end = last + 1;
              const length = contentLength(response);
              if (length !== undefined && length !== end - offset) badRange = true;
            }
          } else if (response.status === 200) {
            if (offset > 0) await reset();
            const length = contentLength(response);
            if (length !== undefined && length !== current.expected.size) throw new DownloadError('BAD_RESPONSE');
            const receivedValidator = validators(response);
            await save({ ...receivedValidator, bytesDone: 0 }, true);
          } else throw new DownloadError('NETWORK_FAILED');
          if (badRange) {
            if (attempt > 0) throw new DownloadError('BAD_RESPONSE');
            controller.abort(); await reset(); continue;
          }
          if (!response.body) {
            if (current.expected.size !== 0) throw new DownloadError('BAD_RESPONSE');
          } else {
            const reader = response.body.getReader();
            const readChunk = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
              let abort = (): void => {};
              const aborted = new Promise<never>((_resolve, reject) => {
                abort = () => { reject(new DownloadError(timedOut ? 'TIMEOUT' : 'CANCELLED')); };
                controller.signal.addEventListener('abort', abort, { once: true });
                if (controller.signal.aborted) abort();
              });
              try { return await Promise.race([reader.read(), aborted]); }
              finally { controller.signal.removeEventListener('abort', abort); }
            };
            const armIdle = (): void => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.idleMs); };
            armIdle();
            try {
              while (true) {
                const chunk = await readChunk();
                if (chunk.done) break;
                armIdle();
                if (position + chunk.value.byteLength > end || position + chunk.value.byteLength > current.expected.size) throw new DownloadError('BAD_RESPONSE');
                let written = 0;
                while (written < chunk.value.byteLength) {
                  let amount: number;
                  try { amount = (await handle.write(chunk.value, written, chunk.value.byteLength - written, position)).bytesWritten; }
                  catch (error) { throw diskError(error); }
                  if (amount <= 0) throw new DownloadError('TRANSFER_IO');
                  written += amount; position += amount;
                }
                options.onProgress?.(position, current.expected.size);
                if (position - current.bytesDone >= CHECKPOINT_BYTES) await save({ bytesDone: position });
                if (options.signal?.aborted) throw new DownloadError('CANCELLED');
              }
            } finally { clearTimeout(timer); controller.abort(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
          }
          if (options.signal?.aborted) throw new DownloadError('CANCELLED');
          if (timedOut) throw new DownloadError('TIMEOUT');
          if (position !== end || position !== current.expected.size) throw new DownloadError('NETWORK_FAILED');
          await save({ bytesDone: position, state: 'complete' }); return current;
        } catch (error) {
          if (journalFailed || error instanceof DownloadError && error.category === 'disk') throw error instanceof DownloadError ? error : new DownloadError('NEEDS_RECOVERY');
          if (options.signal?.aborted && !journalFailed) throw new DownloadError('CANCELLED');
          if (timedOut) throw new DownloadError('TIMEOUT');
          throw error instanceof DownloadError ? error : new DownloadError('NETWORK_FAILED');
        } finally {
          clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); controller.abort();
          if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        }
      }
      throw new DownloadError('BAD_RESPONSE');
    } finally {
      try {
        if (!journalFailed && position !== current.bytesDone) await save({ bytesDone: position, state: 'partial' });
      } finally { await closeStaging(handle); }
    }
  }
}
