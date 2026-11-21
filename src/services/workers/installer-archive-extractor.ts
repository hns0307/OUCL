import { Worker } from 'node:worker_threads';
import type { SelectedArchiveInput } from '../install/native-archive.js';
import { parseInstallerArchiveReply, parseInstallerArchiveRequest } from './installer-archive-protocol.js';
import type { NativeCode } from './native-protocol.js';

export type InstallerExtractionCode = NativeCode | 'EXTRACTION_BUSY' | 'CANCELLED' | 'EXTRACTION_TIMEOUT' | 'WORKER_FAILED';
export class InstallerExtractionError extends Error {
  readonly category: 'validation' | 'network' | 'disk' | 'cancelled' | 'biz' | 'system';
  constructor(readonly code: InstallerExtractionCode) {
    super(code); this.name = 'InstallerExtractionError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'EXTRACTION_BUSY' ? 'biz' : code === 'HASH_MISMATCH' ? 'network'
      : code === 'ARCHIVE_IO' ? 'disk' : code === 'WORKER_FAILED' || code === 'EXTRACTION_TIMEOUT' ? 'system' : 'validation';
  }
}

/** Runs one fixed selective installer extraction and always joins cancellation before returning. */
export class InstallerArchiveExtractor {
  private active?: { done: Promise<void>; stop: () => void };
  private closed = false;
  constructor(private readonly entry: string | URL, private readonly timeoutMs = 120000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new InstallerExtractionError('INVALID_ARCHIVE');
  }

  run(destination: string, archive: SelectedArchiveInput, options: { signal?: AbortSignal } = {}): Promise<{ files: 3; bytes: number }> {
    if (this.closed) return Promise.reject(new InstallerExtractionError('WORKER_FAILED'));
    if (this.active) return Promise.reject(new InstallerExtractionError('EXTRACTION_BUSY'));
    let request;
    try { request = parseInstallerArchiveRequest({ version: 1, kind: 'loader-installer-extract', destination, ...archive }); }
    catch { return Promise.reject(new InstallerExtractionError('INVALID_ARCHIVE')); }
    if (options.signal?.aborted) return Promise.reject(new InstallerExtractionError('CANCELLED'));
    let worker: Worker; try { worker = new Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } }); }
    catch { return Promise.reject(new InstallerExtractionError('WORKER_FAILED')); }
    let failure: InstallerExtractionError | undefined; let result: { files: 3; bytes: number } | undefined;
    let finish: () => void = () => {}; const done = new Promise<void>(resolve => { finish = resolve; });
    const stop = (error = new InstallerExtractionError('CANCELLED')): void => { failure ??= error; void worker.terminate().catch(() => {}); };
    const abort = (): void => stop(); const timer = setTimeout(() => stop(new InstallerExtractionError('EXTRACTION_TIMEOUT')), this.timeoutMs);
    this.active = { done, stop: abort };
    return new Promise((resolve, reject) => {
      worker.on('message', (value: unknown) => {
        if (result || failure) { if (!failure) stop(new InstallerExtractionError('WORKER_FAILED')); return; }
        try { const reply = parseInstallerArchiveReply(value); if (reply.kind === 'loader-installer-failed') failure = new InstallerExtractionError(reply.code); else result = { files: reply.files, bytes: reply.bytes }; }
        catch { stop(new InstallerExtractionError('WORKER_FAILED')); }
      });
      worker.once('error', () => { failure ??= new InstallerExtractionError('WORKER_FAILED'); });
      worker.once('exit', code => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort); delete this.active; finish();
        if (failure) reject(failure); else if (code !== 0 || !result) reject(new InstallerExtractionError('WORKER_FAILED')); else resolve(result);
      });
      options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
    });
  }

  async close(): Promise<void> { this.closed = true; const active = this.active; active?.stop(); await active?.done; }
}
