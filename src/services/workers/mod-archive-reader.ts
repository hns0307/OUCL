import { Worker } from 'node:worker_threads';
import { ModArchiveError } from '../mods/archive.js';
import type { ModArchiveCode, ModArchiveScan } from '../mods/archive.js';
import { parseModArchiveReply, parseModArchiveRequest } from './mod-archive-protocol.js';

/** One active scan per owner; callers may sequence a directory without unbounded worker or message queues. */
export class ModArchiveReader {
  private active = false;
  constructor(private readonly entry: string | URL, private readonly timeoutMs = 30000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new ModArchiveError('WORKER_FAILED');
  }
  /** Joins worker exit on success, cancellation, timeout and malformed replies. */
  async read(file: string, signal?: AbortSignal): Promise<ModArchiveScan> {
    let request;
    try { request = parseModArchiveRequest({ version: 1, kind: 'mod-archive', file }); }
    catch { throw new ModArchiveError('UNSAFE_ARCHIVE'); }
    if (signal?.aborted) throw new ModArchiveError('CANCELLED');
    if (this.active) throw new ModArchiveError('QUEUE_FULL'); this.active = true;
    try {
      const worker = new Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      return await new Promise<ModArchiveScan>((resolve, reject) => {
        let result: ModArchiveScan | undefined; let failure: ModArchiveError | undefined;
        const stop = (code: ModArchiveCode): void => { failure ??= new ModArchiveError(code); void worker.terminate().catch(() => {}); };
        const abort = (): void => stop('CANCELLED'); const timer = setTimeout(() => stop('SCAN_TIMEOUT'), this.timeoutMs);
        worker.on('message', (value: unknown) => {
          if (result || failure) { stop('WORKER_FAILED'); return; }
          try { const reply = parseModArchiveReply(value); if (reply.kind === 'mod-archive-failed') failure = new ModArchiveError(reply.code); else result = reply.result; }
          catch { stop('WORKER_FAILED'); }
        });
        worker.once('error', () => { failure ??= new ModArchiveError('WORKER_FAILED'); });
        worker.once('exit', code => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (failure) reject(failure); else if (code !== 0 || !result) reject(new ModArchiveError('WORKER_FAILED')); else resolve(result);
        });
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      });
    } catch (error) { throw error instanceof ModArchiveError ? error : new ModArchiveError('WORKER_FAILED'); }
    finally { this.active = false; }
  }
}
