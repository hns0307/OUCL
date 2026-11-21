import { Worker } from 'node:worker_threads';
import type { SelectedArchiveInput } from '../install/native-archive.js';
import type { InstallerExtractionCode } from './installer-archive-extractor.js';
import { InstallerExtractionError } from './installer-archive-extractor.js';
import { parseProcessorManifestReply, parseProcessorManifestRequest } from './processor-manifest-protocol.js';

/** Reads one verified processor manifest in a bounded one-shot worker and joins cancellation. */
export class ProcessorManifestReader {
  constructor(private readonly entry: string | URL, private readonly timeoutMs = 30000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new InstallerExtractionError('INVALID_ARCHIVE');
  }

  read(archive: SelectedArchiveInput, signal?: AbortSignal): Promise<string> {
    let request; try { request = parseProcessorManifestRequest({ version: 1, kind: 'processor-manifest', ...archive }); }
    catch { return Promise.reject(new InstallerExtractionError('INVALID_ARCHIVE')); }
    if (signal?.aborted) return Promise.reject(new InstallerExtractionError('CANCELLED'));
    let worker: Worker; try { worker = new Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } }); }
    catch { return Promise.reject(new InstallerExtractionError('WORKER_FAILED')); }
    return new Promise((resolve, reject) => {
      let result: string | undefined; let failure: InstallerExtractionError | undefined; let closed = false;
      const stop = (code: InstallerExtractionCode): void => { failure ??= new InstallerExtractionError(code); void worker.terminate().catch(() => {}); };
      const abort = (): void => stop('CANCELLED'); const timer = setTimeout(() => stop('EXTRACTION_TIMEOUT'), this.timeoutMs);
      worker.on('message', (value: unknown) => {
        if (result || failure) { if (!failure) stop('WORKER_FAILED'); return; }
        try { const reply = parseProcessorManifestReply(value); if (reply.kind === 'processor-manifest-failed') failure = new InstallerExtractionError(reply.code); else result = reply.mainClass; }
        catch { stop('WORKER_FAILED'); }
      });
      worker.once('error', () => { failure ??= new InstallerExtractionError('WORKER_FAILED'); });
      worker.once('exit', code => {
        closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (failure) reject(failure); else if (code !== 0 || !result) reject(new InstallerExtractionError('WORKER_FAILED')); else resolve(result);
      });
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted && !closed) abort();
    });
  }
}
