import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { Execution } from '../../core/task/machine.js';
import type { StoredTask, TaskKind } from '../storage/tasks.js';
import { parseReply, parseStorageRequest, WorkerError } from './protocol.js';
import type { StorageCommand } from './protocol.js';

interface Pending {
  resolve: (task: StoredTask | undefined) => void;
  reject: (error: WorkerError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Single SQLite writer in a worker, with a bounded number of outstanding requests.
 * A response timeout means unknown outcome. It never terminates or rolls back a mutation.
 */
export class StorageClient {
  private readonly pending = new Map<string, Pending>();
  private stopped = false;
  private closing = false;
  private readonly ended: Promise<void>;
  private constructor(private readonly worker: Worker, private readonly timeoutMs: number) {
    this.ended = new Promise(resolve => { worker.once('exit', () => { this.fail(); resolve(); }); });
    worker.on('error', () => { this.fail(); });
  }

  /** Starts only the repository-owned worker entry; directory is supplied by a trusted platform adapter. */
  static async open(entry: string | URL, directory: string, timeoutMs = 10000): Promise<StorageClient> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new WorkerError('INVALID_MESSAGE');
    const worker = new Worker(entry, { workerData: { version: 1, kind: 'storage', directory }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const client = new StorageClient(worker, timeoutMs);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new WorkerError('TIMEOUT')); }, timeoutMs);
        const finish = (error?: WorkerError): void => {
          clearTimeout(timer); worker.off('message', receive); worker.off('exit', exited); worker.off('error', failed);
          if (error) reject(error); else resolve();
        };
        const exited = (): void => { finish(new WorkerError('WORKER_FAILED')); };
        const failed = (): void => { finish(new WorkerError('WORKER_FAILED')); };
        const receive = (input: unknown): void => {
          try {
            const reply = parseReply(input);
            if (reply.kind === 'ready') finish();
            else finish(new WorkerError(reply.kind === 'startup-failed' ? reply.code : 'INVALID_MESSAGE'));
          } catch { finish(new WorkerError('INVALID_MESSAGE')); }
        };
        worker.on('message', receive); worker.once('exit', exited); worker.once('error', failed);
      });
      worker.on('message', input => { client.receive(input); });
      return client;
    } catch (error) { await worker.terminate(); await client.ended; throw error; }
  }

  private fail(): void {
    this.stopped = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new WorkerError('WORKER_FAILED')); }
    this.pending.clear();
  }

  private receive(input: unknown): void {
    try {
      const reply = parseReply(input);
      if (reply.kind !== 'response') { this.fail(); void this.worker.terminate(); return; }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.task); else pending.reject(new WorkerError(reply.code));
    } catch { this.fail(); void this.worker.terminate(); }
  }

  private request(command: StorageCommand, shuttingDown = false): Promise<StoredTask | undefined> {
    if (this.stopped || this.closing && !shuttingDown) return Promise.reject(new WorkerError('WORKER_FAILED'));
    if (this.pending.size >= 32 && !shuttingDown) return Promise.reject(new WorkerError('QUEUE_FULL'));
    const request = parseStorageRequest({ version: 1, id: randomUUID(), command });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Keep the slot until the worker replies/exits: timeouts must not permit an unbounded hidden backlog.
        reject(new WorkerError('TIMEOUT'));
      }, this.timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer });
      try { this.worker.postMessage(request); }
      catch { this.pending.delete(request.id); clearTimeout(timer); reject(new WorkerError('INVALID_MESSAGE')); }
    });
  }

  /** Durable idempotent acceptance; retry with the same business requestId after an unknown outcome. */
  async accept(ownerId: string, requestId: string, taskKind: TaskKind, payloadDigest: string): Promise<StoredTask> {
    const task = await this.request({ kind: 'accept', ownerId, requestId, taskKind, payloadDigest });
    if (!task) throw new WorkerError('INVALID_MESSAGE'); return task;
  }

  /** Queries only the stable owner's task, including after a caller timeout. */
  get(ownerId: string, taskId: string): Promise<StoredTask | undefined> { return this.request({ kind: 'get', ownerId, taskId }); }

  /** Saves a transition before its effects run outside the storage worker. */
  async update(ownerId: string, taskId: string, expectedRevision: number, execution: Execution): Promise<StoredTask> {
    const task = await this.request({ kind: 'update', ownerId, taskId, expectedRevision, execution });
    if (!task) throw new WorkerError('INVALID_MESSAGE'); return task;
  }

  /** Drains earlier requests, closes the database, releases its own lease and waits for thread exit. */
  async close(): Promise<void> {
    if (this.stopped) { await this.ended; return; }
    if (this.closing) { await this.ended; return; }
    this.closing = true;
    try { await this.request({ kind: 'close' }, true); await this.ended; }
    catch (error) { await this.worker.terminate(); await this.ended; throw error; }
  }
}
