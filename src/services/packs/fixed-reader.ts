import { Worker } from 'node:worker_threads';
import { parseFixedPackReply, parseFixedPackRequest } from './fixed-protocol.js';
import type { FixedPackPreview } from '../../core/packs/fixed-preview.js';

/** One bounded private worker; cancellation and errors settle only after worker exit. */
export class FixedPackReader {
  private active = false;
  constructor(private readonly entry: string | URL, private readonly timeoutMs = 120000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('INVALID_TIMEOUT');
  }
  async preview(file: string, signal?: AbortSignal): Promise<FixedPackPreview> {
    const request = parseFixedPackRequest({ version: 1, kind: 'fixed-pack-preview', file });
    if (signal?.aborted) throw new Error('CANCELLED');
    if (this.active) throw new Error('QUEUE_FULL');
    this.active = true;
    try {
      const worker = new Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      return await new Promise<FixedPackPreview>((resolve, reject) => {
        let result: FixedPackPreview | undefined; let failure: string | undefined;
        const stop = (code: string): void => { failure ??= code; void worker.terminate().catch(() => {}); };
        const abort = (): void => stop('CANCELLED');
        const timer = setTimeout(() => stop('TIMEOUT'), this.timeoutMs);
        worker.on('message', (message: unknown) => {
          if (result || failure) { stop('WORKER_FAILED'); return; }
          try { const reply = parseFixedPackReply(message); if (reply.kind === 'fixed-pack-failed') failure = reply.code; else result = reply.preview; }
          catch { stop('WORKER_FAILED'); }
        });
        worker.once('error', () => { failure ??= 'WORKER_FAILED'; });
        worker.once('exit', code => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (failure || code !== 0 || !result) reject(new Error(failure ?? 'WORKER_FAILED')); else resolve(result);
        });
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      });
    } finally { this.active = false; }
  }
}
