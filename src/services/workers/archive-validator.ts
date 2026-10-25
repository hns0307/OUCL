import { Worker } from 'node:worker_threads';
import { InstallerExtractionError } from './installer-archive-extractor.js';
import { parseArchiveValidationReply, parseArchiveValidationRequest } from './archive-validation-protocol.js';

/** Fully validates one service-selected processor ZIP/JAR in a bounded worker. */
export class ProcessorArchiveValidator {
  constructor(private readonly entry: string | URL, private readonly timeoutMs = 120000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new InstallerExtractionError('INVALID_ARCHIVE');
  }
  validate(file: string, sha256: string, size: number, signal?: AbortSignal): Promise<void> {
    let request; try { request = parseArchiveValidationRequest({ version: 1, kind: 'processor-output-validate', file, sha256, size }); }
    catch { return Promise.reject(new InstallerExtractionError('INVALID_ARCHIVE')); }
    if (signal?.aborted) return Promise.reject(new InstallerExtractionError('CANCELLED'));
    let worker: Worker; try { worker = new Worker(this.entry, { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 384 } }); }
    catch { return Promise.reject(new InstallerExtractionError('WORKER_FAILED')); }
    return new Promise((resolve, reject) => {
      let accepted = false; let failure: InstallerExtractionError | undefined;
      const stop = (error: InstallerExtractionError): void => { failure ??= error; void worker.terminate().catch(() => {}); };
      const abort = (): void => stop(new InstallerExtractionError('CANCELLED'));
      const timer = setTimeout(() => stop(new InstallerExtractionError('EXTRACTION_TIMEOUT')), this.timeoutMs);
      worker.on('message', (value: unknown) => {
        if (accepted || failure) { if (!failure) stop(new InstallerExtractionError('WORKER_FAILED')); return; }
        try { const reply = parseArchiveValidationReply(value); if (reply.kind === 'processor-output-invalid') failure = new InstallerExtractionError(reply.code); else accepted = true; }
        catch { stop(new InstallerExtractionError('WORKER_FAILED')); }
      });
      worker.once('error', () => { failure ??= new InstallerExtractionError('WORKER_FAILED'); });
      worker.once('exit', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (failure) reject(failure); else if (code !== 0 || !accepted) reject(new InstallerExtractionError('WORKER_FAILED')); else resolve();
      });
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }
}
