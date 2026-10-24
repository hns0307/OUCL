import { Worker } from 'node:worker_threads';
import { parseReply, WorkerError } from './protocol.js';
import type { HashResult } from './protocol.js';

export interface HashOptions { maximumBytes: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
interface Job {
  file: string; options: HashOptions;
  resolve: (value: HashResult) => void; reject: (error: WorkerError) => void;
  abort: () => void; worker?: Worker; error?: WorkerError; result?: HashResult;
  timer?: ReturnType<typeof setTimeout>;
}

/** Bounded streaming digest workers. Renderer code never receives this privileged API. */
export class HashPool {
  private readonly queue: Job[] = [];
  private readonly active = new Set<Job>();
  private closed = false;
  private readonly drained = new Set<() => void>();
  constructor(private readonly entry: string | URL, private readonly concurrency = 2) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new WorkerError('INVALID_MESSAGE');
  }

  /** Hashes a main-process-approved staging path; completion/cancellation waits for actual worker exit. */
  hash(file: string, options: HashOptions): Promise<HashResult> {
    if (this.closed) return Promise.reject(new WorkerError('WORKER_FAILED'));
    if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 0 || options.maximumBytes > 64 * 1024 ** 3) return Promise.reject(new WorkerError('INVALID_MESSAGE'));
    if (options.signal?.aborted) return Promise.reject(new WorkerError('CANCELLED'));
    if (this.queue.length >= 32) return Promise.reject(new WorkerError('QUEUE_FULL'));
    return new Promise((resolve, reject) => {
      const job: Job = { file, options, resolve, reject, abort: () => { this.cancel(job); } };
      options.signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job); this.pump();
    });
  }

  private cancel(job: Job): void {
    job.error = new WorkerError('CANCELLED');
    if (job.worker) { void job.worker.terminate(); return; }
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    job.options.signal?.removeEventListener('abort', job.abort);
    job.reject(job.error); this.notifyDrained();
  }

  private pump(): void {
    while (!this.closed && this.active.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.active.add(job);
      try {
        const worker = new Worker(this.entry, { workerData: { version: 1, kind: 'hash', file: job.file, maximumBytes: job.options.maximumBytes },
          resourceLimits: { maxOldGenerationSizeMb: 64 } });
        job.worker = worker;
        job.timer = setTimeout(() => { job.error = new WorkerError('TIMEOUT'); void worker.terminate(); }, 120000);
        worker.on('message', (input: unknown) => {
          if (job.error) return;
          try {
            const reply = parseReply(input);
            if (reply.kind === 'hash-result') job.result = reply.result;
            else if (reply.kind === 'hash-progress') job.options.onProgress?.(reply.bytesDone, reply.bytesTotal);
            else throw new WorkerError(reply.kind === 'startup-failed' ? reply.code : 'INVALID_MESSAGE');
          } catch (error) { job.error = error instanceof WorkerError ? error : new WorkerError('WORKER_FAILED'); void worker.terminate(); }
        });
        worker.once('error', () => { job.error = new WorkerError('WORKER_FAILED'); });
        worker.once('exit', status => { this.finish(job, status); });
      } catch { job.error = new WorkerError('WORKER_FAILED'); this.finish(job, 1); }
    }
  }

  private finish(job: Job, status: number): void {
    clearTimeout(job.timer);
    job.options.signal?.removeEventListener('abort', job.abort);
    this.active.delete(job);
    if (job.error) job.reject(job.error);
    else if (status !== 0 || !job.result) job.reject(new WorkerError('WORKER_FAILED'));
    else job.resolve(job.result);
    this.pump(); this.notifyDrained();
  }

  private notifyDrained(): void {
    if (this.active.size || this.queue.length) return;
    for (const resolve of this.drained) resolve(); this.drained.clear();
  }

  /** Cancels queued/active work and joins every thread before resolving. */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of [...this.queue, ...this.active]) this.cancel(job);
    if (this.active.size) await new Promise<void>(resolve => { this.drained.add(resolve); });
  }
}
