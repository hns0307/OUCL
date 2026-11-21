import { Worker } from 'node:worker_threads';
import { parseNativeReply, parseNativeRequest } from './native-protocol.js';
import type { NativeArchiveInput } from '../install/native-archive.js';
import type { NativeCode } from './native-protocol.js';

export type ExtractionCode = NativeCode | 'EXTRACTION_BUSY' | 'CANCELLED' | 'EXTRACTION_TIMEOUT' | 'WORKER_FAILED';
/** Fixed privileged-service errors; no file paths or worker stacks cross this boundary. */
export class ExtractionError extends Error {
  readonly category: 'validation' | 'network' | 'disk' | 'cancelled' | 'biz' | 'system';
  constructor(readonly code: ExtractionCode) {
    super(code); this.name = 'ExtractionError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'EXTRACTION_BUSY' ? 'biz' : code === 'HASH_MISMATCH' ? 'network'
      : code === 'ARCHIVE_IO' ? 'disk' : code === 'WORKER_FAILED' || code === 'EXTRACTION_TIMEOUT' ? 'system' : 'validation';
  }
}

/** Runs at most one memory/time-bounded native extraction; cancellation always joins the one-shot worker. */
export class NativeExtractor {
  private active?: { done: Promise<void>; stop: () => void };
  private closed = false;
  constructor(private readonly entry: string | URL, private readonly timeoutMs = 120000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new ExtractionError('INVALID_ARCHIVE');
  }

  /** Extracts into an empty installer-owned staging directory; no existing natives/player directory is accepted. */
  run(destination: string, archives: readonly NativeArchiveInput[], options: { signal?: AbortSignal } = {}): Promise<{ files: number; bytes: number }> {
    if (this.closed) return Promise.reject(new ExtractionError('WORKER_FAILED'));
    if (this.active) return Promise.reject(new ExtractionError('EXTRACTION_BUSY'));
    let request;
    try { request = parseNativeRequest({ version: 1, kind: 'native-extract', destination, archives }); }
    catch { return Promise.reject(new ExtractionError('INVALID_ARCHIVE')); }
    if (options.signal?.aborted) return Promise.reject(new ExtractionError('CANCELLED'));
    let worker: Worker;
    try { worker = new Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } }); }
    catch { return Promise.reject(new ExtractionError('WORKER_FAILED')); }
    let failure: ExtractionError | undefined; let result: { files: number; bytes: number } | undefined;
    let finish: () => void = () => {}; const done = new Promise<void>(resolve => { finish = resolve; });
    const stop = (error = new ExtractionError('CANCELLED')): void => { failure ??= error; void worker.terminate().catch(() => {}); };
    const abort = (): void => stop();
    const timer = setTimeout(() => stop(new ExtractionError('EXTRACTION_TIMEOUT')), this.timeoutMs);
    this.active = { done, stop: abort };
    return new Promise((resolve, reject) => {
      worker.on('message', (value: unknown) => {
        if (result || failure) { if (!failure) stop(new ExtractionError('WORKER_FAILED')); return; }
        try {
          const reply = parseNativeReply(value);
          if (reply.kind === 'native-failed') failure = new ExtractionError(reply.code);
          else result = { files: reply.files, bytes: reply.bytes };
        } catch { stop(new ExtractionError('WORKER_FAILED')); }
      });
      worker.once('error', () => { failure ??= new ExtractionError('WORKER_FAILED'); });
      worker.once('exit', code => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort); delete this.active; finish();
        if (failure) reject(failure);
        else if (code !== 0 || !result) reject(new ExtractionError('WORKER_FAILED'));
        else resolve(result);
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }

  /** Stops admission and waits for all worker-held handles to be released before the caller may remove staging. */
  async close(): Promise<void> { this.closed = true; const active = this.active; active?.stop(); await active?.done; }
}
