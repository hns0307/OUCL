import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { parseHashJobRequest, parseReply, WorkerError } from './protocol.js';
import type { HashResult } from './protocol.js';

export interface HashOptions { maximumBytes: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
interface Job {
  id: string; file: string; options: HashOptions;
  resolve: (value: HashResult) => void; reject: (error: WorkerError) => void;
  abort: () => void; slot?: Slot; error?: WorkerError; timer?: ReturnType<typeof setTimeout>;
}
interface Slot { worker: Worker; ended: Promise<void>; ready: boolean; retiring: boolean; job?: Job }

/** Bounded reusable hash-only sessions. Renderer code never receives this privileged API. */
export class HashPool {
  private readonly queue: Job[] = [];
  private readonly slots = new Set<Slot>();
  private closed = false;
  private closing: Promise<void> | undefined;
  private spawned = 0;
  constructor(private readonly entry: string | URL, private readonly concurrency = 2) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new WorkerError('INVALID_MESSAGE');
  }

  /** Number of actual worker constructions, including replacements, for bounded diagnostic evidence. */
  get spawnedWorkers(): number { return this.spawned; }

  /** Hashes an approved staging path; cancellation waits for the owning session to terminate. */
  hash(file: string, options: HashOptions): Promise<HashResult> {
    if (this.closed) return Promise.reject(new WorkerError('WORKER_FAILED'));
    const id = randomUUID();
    try { parseHashJobRequest({ version: 1, kind: 'hash-job', jobId: id, file, maximumBytes: options.maximumBytes }); }
    catch { return Promise.reject(new WorkerError('INVALID_MESSAGE')); }
    if (options.signal?.aborted) return Promise.reject(new WorkerError('CANCELLED'));
    if (this.queue.length >= 32) return Promise.reject(new WorkerError('QUEUE_FULL'));
    return new Promise((resolve, reject) => {
      const job: Job = { id, file, options, resolve, reject, abort: () => { this.cancel(job); } };
      options.signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job); this.pump();
    });
  }

  private cancel(job: Job): void {
    job.error ??= new WorkerError('CANCELLED');
    if (job.slot) { this.retire(job.slot); return; }
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    job.options.signal?.removeEventListener('abort', job.abort); job.reject(job.error);
  }

  private spawn(): Slot {
    const worker = new Worker(this.entry, { workerData: { version: 1, kind: 'hash-session' }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    this.spawned++;
    let ended: () => void = () => {};
    const slot: Slot = { worker, ready: false, retiring: false, ended: new Promise<void>(resolve => { ended = resolve; }) };
    this.slots.add(slot);
    worker.on('message', (input: unknown) => { this.receive(slot, input); });
    worker.once('error', () => { if (slot.job) slot.job.error ??= new WorkerError('WORKER_FAILED'); this.retire(slot); });
    worker.once('exit', () => {
      this.slots.delete(slot);
      if (slot.job) this.finish(slot, undefined, slot.job.error ?? new WorkerError('WORKER_FAILED'));
      ended(); this.pump();
    });
    return slot;
  }

  private retire(slot: Slot): void {
    if (slot.retiring) return;
    slot.retiring = true; void slot.worker.terminate();
  }

  private send(slot: Slot): void {
    const job = slot.job;
    if (!slot.ready || slot.retiring || !job) return;
    try { slot.worker.postMessage({ version: 1, kind: 'hash-job', jobId: job.id, file: job.file, maximumBytes: job.options.maximumBytes }); }
    catch { job.error = new WorkerError('WORKER_FAILED'); this.retire(slot); }
  }

  private receive(slot: Slot, input: unknown): void {
    if (slot.retiring) return;
    try {
      const reply = parseReply(input);
      if (reply.kind === 'hash-ready') {
        if (slot.ready) throw new WorkerError('INVALID_MESSAGE');
        slot.ready = true; this.send(slot); return;
      }
      if (reply.kind === 'startup-failed') throw new WorkerError(reply.code);
      if (!['hash-job-progress', 'hash-job-result', 'hash-job-failed'].includes(reply.kind) || !('jobId' in reply)) throw new WorkerError('INVALID_MESSAGE');
      const job = slot.job;
      // An old job's well-formed late result cannot finish a newer job on the same session.
      if (!job || reply.jobId !== job.id) return;
      if (reply.kind === 'hash-job-progress') job.options.onProgress?.(reply.bytesDone, reply.bytesTotal);
      else if (reply.kind === 'hash-job-result') this.finish(slot, reply.result);
      else if (reply.kind === 'hash-job-failed') this.finish(slot, undefined, new WorkerError(reply.code));
    } catch (error) {
      if (slot.job) slot.job.error ??= error instanceof WorkerError ? error : new WorkerError('WORKER_FAILED');
      this.retire(slot);
    }
  }

  private pump(): void {
    while (!this.closed && this.queue.length) {
      let slot = [...this.slots].find(item => !item.retiring && !item.job);
      if (!slot && this.slots.size >= this.concurrency) return;
      const job = this.queue.shift()!;
      try { slot ??= this.spawn(); }
      catch { job.options.signal?.removeEventListener('abort', job.abort); job.reject(new WorkerError('WORKER_FAILED')); continue; }
      slot.job = job; job.slot = slot;
      const owned = slot;
      job.timer = setTimeout(() => { job.error ??= new WorkerError('TIMEOUT'); this.retire(owned); }, 120000);
      this.send(slot);
    }
  }

  private finish(slot: Slot, result?: HashResult, error?: WorkerError): void {
    const job = slot.job;
    if (!job) return;
    clearTimeout(job.timer); job.options.signal?.removeEventListener('abort', job.abort);
    delete slot.job; delete job.slot;
    if (job.error || error) job.reject(job.error ?? error!);
    else if (result) job.resolve(result);
    else job.reject(new WorkerError('WORKER_FAILED'));
    this.pump();
  }

  /** Cancels queued/active work, terminates idle sessions and joins all threads before resolving. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const job of [...this.queue]) this.cancel(job);
    const slots = [...this.slots];
    for (const slot of slots) { if (slot.job) this.cancel(slot.job); else this.retire(slot); }
    this.closing = Promise.all(slots.map(slot => slot.ended)).then(() => {});
    return this.closing;
  }
}
