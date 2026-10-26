import type { FileHandle } from 'node:fs/promises';
import { HttpTransfer, diskError, writableStaging } from './http.js';
import { DownloadError, parseTransferRecord } from './types.js';
import type { TransferCheckpoint, TransferOptions, TransferRecord } from './types.js';
import { RequestBudget } from './request-budget.js';

const PIECE = 4 * 1024 ** 2;
const strongTag = (value: string | null): value is string => value !== null && /^"[\x21\x23-\x7e]{0,180}"$/.test(value);
function responseRange(response: Response, start: number, end: number, size: number, tag?: string): boolean {
  const expected = `bytes ${start}-${end}/${size}`;
  const length = response.headers.get('content-length'); const encoding = response.headers.get('content-encoding');
  return response.status === 206 && response.headers.get('content-range') === expected
    && (length === null || length === String(end - start + 1)) && (encoding === null || encoding.toLowerCase() === 'identity')
    && (tag === undefined || response.headers.get('etag') === tag);
}

/** Parallel writes have no durable holes: only complete, fsynced contiguous pieces advance the checkpoint. */
export class ParallelHttpTransfer {
  constructor(private readonly request: typeof fetch = fetch, private readonly budget = new RequestBudget(),
    private readonly headerMs = 15000, private readonly idleMs = 30000) {}
  async run(file: string, record: TransferRecord, checkpoint: TransferCheckpoint, options: TransferOptions = {}, connections = 4): Promise<TransferRecord> {
    let current = parseTransferRecord(record);
    if (!Number.isSafeInteger(connections) || connections < 1 || connections > 8) throw new DownloadError('INVALID_TRANSFER');
    const host = new URL(current.url).hostname;
    const single = (): Promise<TransferRecord> => this.budget.run(host, options.signal, () => new HttpTransfer(this.request).run(file, current, checkpoint, options));
    if (connections === 1 || current.expected.size - current.bytesDone < 8 * 1024 ** 2 || current.state !== 'partial') return single();
    // Probe one byte. Servers without an exact range plus strong entity identity use the established serial path.
    const probe = await this.budget.run(host, options.signal, async () => {
      const controller = new AbortController(); const abort = (): void => controller.abort();
      options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) controller.abort();
      const timer = setTimeout(abort, this.headerMs); let response: Response | undefined;
      try {
        response = await this.request(current.url, { redirect: 'error', credentials: 'omit', signal: controller.signal,
          headers: { Range: `bytes=${current.bytesDone}-${current.bytesDone}`, 'accept-encoding': 'identity' } });
        if (response.status === 429 || response.status === 503) throw new DownloadError('RETRY_LATER');
        const tag = response.headers.get('etag');
        return responseRange(response, current.bytesDone, current.bytesDone, current.expected.size) && strongTag(tag) ? tag : undefined;
      } catch (error) { throw options.signal?.aborted ? new DownloadError('CANCELLED') : error instanceof DownloadError ? error : new DownloadError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_FAILED'); }
      finally { controller.abort(); clearTimeout(timer); options.signal?.removeEventListener('abort', abort); await response?.body?.cancel().catch(() => {}); }
    });
    if (!probe) return single();
    const handle = await writableStaging(file, current.bytesDone);
    const controller = new AbortController(); const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) controller.abort();
    let writes: Promise<void> = Promise.resolve(); let journalFailed = false; let failure: unknown;
    const save = async (done: number, state: 'partial' | 'complete', reset = false): Promise<void> => {
      await handle.sync().catch(error => { throw diskError(error); });
      const base = { ...current }; delete base.lastModified;
      const next = parseTransferRecord({ ...base, bytesDone: done, state, etag: probe, revision: current.revision + 1 });
      try { await checkpoint(current.revision, next); } catch { journalFailed = true; throw new DownloadError('NEEDS_RECOVERY'); }
      current = next;
      if (reset) { await handle.truncate(0).catch(error => { throw diskError(error); }); await handle.sync().catch(error => { throw diskError(error); }); }
    };
    try {
      if (current.bytesDone > 0 && current.etag !== probe) await save(0, 'partial', true);
      else await save(current.bytesDone, 'partial');
      const origin = current.bytesDone; const count = Math.ceil((current.expected.size - origin) / PIECE);
      const completed = new Set<number>(); let transferred = origin; let next = 0; let prefix = 0;
      const piece = async (index: number): Promise<void> => {
        const start = origin + index * PIECE; const end = Math.min(current.expected.size, start + PIECE) - 1;
        let observed = 0;
        await this.budget.run(host, controller.signal, () => this.readPiece(handle, current.url, start, end, current.expected.size, probe, controller.signal, done => {
          transferred += done - observed; observed = done; options.onProgress?.(transferred, current.expected.size);
        }));
        completed.add(index);
        const operation = writes.then(async () => {
          while (completed.has(prefix)) prefix++;
          const done = Math.min(current.expected.size, origin + prefix * PIECE);
          if (done > current.bytesDone) await save(done, done === current.expected.size ? 'complete' : 'partial');
        }); writes = operation; await operation;
      };
      const lane = async (): Promise<void> => {
        try { while (next < count && !controller.signal.aborted) await piece(next++); }
        catch (error) { if (failure === undefined || error instanceof DownloadError && ['NEEDS_RECOVERY', 'TRANSFER_IO', 'DISK_FULL', 'DISK_PERMISSION'].includes(error.code)) failure = error; controller.abort(); }
      };
      await Promise.allSettled(Array.from({ length: Math.min(connections, count) }, lane));
      await writes.catch(error => { failure = error; });
      if (journalFailed) throw new DownloadError('NEEDS_RECOVERY');
      if (failure !== undefined) throw failure;
      if (options.signal?.aborted) throw new DownloadError('CANCELLED');
      if (current.bytesDone !== current.expected.size) throw new DownloadError('BAD_RESPONSE');
      return current;
    } finally {
      controller.abort(); options.signal?.removeEventListener('abort', abort);
      await handle.close().catch(error => { throw diskError(error); });
    }
  }
  private async readPiece(handle: FileHandle, url: string, start: number, end: number, size: number, tag: string, signal: AbortSignal,
    progress: (done: number) => void): Promise<void> {
    const controller = new AbortController(); let timedOut = false; const abort = (): void => controller.abort();
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) controller.abort();
    let timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.headerMs); let response: Response | undefined;
    try {
      response = await this.request(url, { redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { Range: `bytes=${start}-${end}`, 'if-range': tag, 'accept-encoding': 'identity' } });
      if (!responseRange(response, start, end, size, tag) || !response.body) throw new DownloadError('BAD_RESPONSE');
      const arm = (): void => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.idleMs); };
      arm(); let position = start;
      const reader = response.body.getReader();
      try { while (true) {
        let cancelRead = (): void => {};
        const aborted = new Promise<never>((_resolve, reject) => {
          cancelRead = () => reject(new DownloadError(timedOut ? 'TIMEOUT' : 'CANCELLED'));
          controller.signal.addEventListener('abort', cancelRead, { once: true });
          if (controller.signal.aborted) cancelRead();
        });
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await Promise.race([reader.read(), aborted]); }
        finally { controller.signal.removeEventListener('abort', cancelRead); }
        if (chunk.done) break;
        const bytes = chunk.value;
        if (controller.signal.aborted) throw new DownloadError(timedOut ? 'TIMEOUT' : 'CANCELLED'); arm();
        if (position + bytes.byteLength > end + 1) throw new DownloadError('BAD_RESPONSE');
        let offset = 0;
        while (offset < bytes.byteLength) {
          const written = await handle.write(bytes, offset, bytes.byteLength - offset, position).catch(error => { throw diskError(error); });
          if (written.bytesWritten <= 0) throw new DownloadError('TRANSFER_IO'); offset += written.bytesWritten; position += written.bytesWritten;
        }
        progress(position - start);
      } } finally { controller.abort(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (position !== end + 1) throw new DownloadError('BAD_RESPONSE');
    } catch (error) { throw error instanceof DownloadError ? error : new DownloadError(signal.aborted ? 'CANCELLED' : timedOut ? 'TIMEOUT' : 'NETWORK_FAILED'); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }
}
