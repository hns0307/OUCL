import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { definition, sourceKey } from '../objects/provenance.js';
import type { ObjectRef } from '../objects/store.js';
import { DownloadError, isArtifactUrl } from './types.js';
import type { DownloadSpec, TransferOptions } from './types.js';

interface PhysicalTransfer { run(spec: DownloadSpec, options?: TransferOptions): Promise<ObjectRef> }
interface SourceAttestor { adopt(digest: string, expected: DownloadSpec['expected'], anchor: DownloadSpec['anchor']): Promise<ObjectRef> }
type ConsumerState = 'active' | 'pausing' | 'paused' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
export interface ConsumerOptions { consumerId: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
export interface DownloadConsumer {
  readonly id: string; readonly result: Promise<ObjectRef>;
  state(): ConsumerState; pause(): Promise<void>; resume(): Promise<void>; cancel(): Promise<void>;
}
/** Fixed live-coordination error. Persistence, owner authorization and IPC mapping belong to the task service. */
export class CoordinatorError extends Error {
  readonly category: 'biz' | 'system';
  constructor(readonly code: 'INVALID_CONSUMER' | 'INVALID_STATE' | 'CANCEL_TOO_LATE' | 'QUEUE_FULL' | 'CALLBACK_FAILED') {
    super(code); this.name = 'CoordinatorError'; this.category = code === 'CALLBACK_FAILED' ? 'system' : 'biz';
  }
}
interface Consumer {
  id: string; spec: DownloadSpec; state: ConsumerState; options: ConsumerOptions; job: Job;
  resolve: (object: ObjectRef) => void; reject: (error: Error) => void; abort: () => void;
  delivery?: Promise<void>; failure?: Error;
}
interface Job {
  key: string; spec: DownloadSpec; consumers: Set<Consumer>; proofs: Map<string, Promise<ObjectRef>>;
  controller?: AbortController; cycle?: Promise<void>; object?: ObjectRef;
}

/** Shares bounded live transfers by trusted content identity while keeping each consumer's source proof independent.
 * This service intentionally does not pretend to persist installer associations or renderer subscriptions.
 */
export class DownloadCoordinator {
  private readonly jobs = new Map<string, Job>();
  private readonly consumers = new Map<string, Consumer>();
  private readonly deliveries = new Set<Promise<void>>();
  private active = 0;
  private closed = false;
  constructor(private readonly physical: PhysicalTransfer, private readonly attestor: SourceAttestor,
    private readonly concurrency = 4, private readonly maxJobs = 128, private readonly maxConsumers = 1024) {
    if (![concurrency, maxJobs, maxConsumers].every(Number.isSafeInteger) || concurrency < 1 || concurrency > 16
      || maxJobs < concurrency || maxJobs > 4096 || maxConsumers < 1 || maxConsumers > 10000) throw new CoordinatorError('INVALID_CONSUMER');
  }

  /** Registers a stable internal consumer; UI event unsubscribe must never call cancel. */
  request(spec: DownloadSpec, options: ConsumerOptions): DownloadConsumer {
    if (this.closed || !UUID_PATTERN.test(options.consumerId) || this.consumers.has(options.consumerId) || !isArtifactUrl(spec.url)) throw new CoordinatorError('INVALID_CONSUMER');
    const canonical: DownloadSpec = { url: spec.url, ...definition(spec.expected, spec.anchor) };
    const realm = canonical.anchor.kind.startsWith('mojang-') ? 'mojang' : canonical.anchor.kind === 'modrinth-version' ? 'modrinth' : 'adoptium';
    const key = `${realm}:${canonical.expected.algorithm}:${canonical.expected.digest}:${canonical.expected.size}`;
    let job = this.jobs.get(key);
    if (this.consumers.size >= this.maxConsumers || !job && this.jobs.size >= this.maxJobs) throw new CoordinatorError('QUEUE_FULL');
    if (!job) { job = { key, spec: canonical, consumers: new Set(), proofs: new Map() }; this.jobs.set(key, job); }
    let resolve: (value: ObjectRef) => void = () => {}; let reject: (error: Error) => void = () => {};
    const result = new Promise<ObjectRef>((yes, no) => { resolve = yes; reject = no; });
    // Consumers may remain paused without an awaiting UI; keep rejection handled while preserving result semantics.
    void result.catch(() => {});
    const consumer: Consumer = { id: options.consumerId, spec: canonical, state: 'active', options, job, resolve, reject,
      abort: () => { void this.cancel(consumer).catch(() => {}); } };
    const handle: DownloadConsumer = Object.freeze({ id: consumer.id, result, state: () => consumer.state,
      pause: () => this.pause(consumer), resume: () => this.resume(consumer), cancel: () => this.cancel(consumer) });
    this.consumers.set(consumer.id, consumer); job.consumers.add(consumer);
    options.signal?.addEventListener('abort', consumer.abort, { once: true });
    if (options.signal?.aborted) void this.cancel(consumer);
    else if (job.object) this.deliver(consumer);
    this.pump(); return handle;
  }

  private demand(job: Job): boolean { return [...job.consumers].some(consumer => consumer.state === 'active'); }
  private settle(consumer: Consumer, state: 'cancelled' | 'completed' | 'failed', value: ObjectRef | Error): void {
    consumer.state = state; consumer.options.signal?.removeEventListener('abort', consumer.abort);
    this.consumers.delete(consumer.id); consumer.job.consumers.delete(consumer);
    if (state === 'completed') consumer.resolve({ ...value as ObjectRef }); else consumer.reject(value as Error);
    this.clean(consumer.job);
  }
  private clean(job: Job): void { if (!job.cycle && job.consumers.size === 0 && this.jobs.get(job.key) === job) this.jobs.delete(job.key); }
  private pump(): void {
    if (this.closed) return;
    for (const job of this.jobs.values()) {
      if (this.active >= this.concurrency) break;
      if (!job.cycle && !job.object && this.demand(job)) this.start(job);
    }
  }
  private start(job: Job): void {
    const controller = new AbortController(); job.controller = controller; this.active++;
    let release: () => void = () => {}; job.cycle = new Promise<void>(resolve => { release = resolve; });
    void (async () => {
      let failure: Error | undefined;
      try {
        job.object = await this.physical.run(job.spec, { signal: controller.signal, onProgress: (done, total) => {
          if (job.controller !== controller || controller.signal.aborted) return;
          for (const consumer of [...job.consumers]) {
            if (consumer.state !== 'active') continue;
            try { consumer.options.onProgress?.(done, total); }
            catch { this.settle(consumer, 'failed', new CoordinatorError('CALLBACK_FAILED')); }
          }
          if (!this.demand(job)) controller.abort();
        } });
      } catch (error) {
        if (!(controller.signal.aborted && error instanceof DownloadError && error.code === 'CANCELLED')) failure = error instanceof DownloadError ? error : new DownloadError('TRANSFER_IO');
      } finally {
        this.active--; delete job.controller; delete job.cycle;
        for (const consumer of [...job.consumers]) {
          if (failure) { consumer.failure = failure; this.settle(consumer, 'failed', failure); }
          else if (consumer.state === 'cancelling') this.settle(consumer, 'cancelled', new DownloadError('CANCELLED'));
          else if (consumer.state === 'pausing') consumer.state = 'paused';
        }
        if (job.object) for (const consumer of job.consumers) if (consumer.state === 'active') this.deliver(consumer);
        this.clean(job); release(); this.pump();
      }
    })();
  }

  private deliver(consumer: Consumer): void {
    const job = consumer.job; if (!job.object || consumer.delivery || consumer.state !== 'active') return;
    const key = sourceKey(consumer.spec.expected, consumer.spec.anchor);
    let proof = job.proofs.get(key);
    if (!proof) {
      proof = key === job.object.sourceKey ? Promise.resolve(job.object) : this.attestor.adopt(job.object.digest, consumer.spec.expected, consumer.spec.anchor);
      job.proofs.set(key, proof);
    }
    const delivery = (async () => {
      try {
        const object = await proof;
        if (object.digest !== job.object?.digest || object.size !== consumer.spec.expected.size || object.sourceKey !== key) throw new DownloadError('NEEDS_RECOVERY');
        if (consumer.state === 'active') this.settle(consumer, 'completed', object);
      }
      catch (error) {
        consumer.failure = error instanceof DownloadError ? error : new DownloadError('TRANSFER_IO');
        if (consumer.state === 'active' || consumer.state === 'paused') this.settle(consumer, 'failed', consumer.failure);
      }
      finally { if (consumer.delivery) this.deliveries.delete(consumer.delivery); delete consumer.delivery; }
    })();
    consumer.delivery = delivery; this.deliveries.add(delivery);
  }
  private async pause(consumer: Consumer): Promise<void> {
    if (this.closed) throw new CoordinatorError('INVALID_STATE');
    if (consumer.state === 'pausing') { await consumer.job.cycle; return; }
    if (consumer.state === 'paused') return;
    if (consumer.state !== 'active') throw new CoordinatorError('INVALID_STATE');
    consumer.state = 'paused';
    if (!this.demand(consumer.job) && consumer.job.cycle) {
      consumer.state = 'pausing'; consumer.job.controller?.abort(); await consumer.job.cycle;
      if (consumer.state === 'pausing') consumer.state = 'paused';
    }
  }
  private async resume(consumer: Consumer): Promise<void> {
    if (consumer.state === 'pausing') await consumer.job.cycle;
    if (consumer.state === 'paused') await consumer.delivery;
    if (this.closed) throw new CoordinatorError('INVALID_STATE');
    if (consumer.state === 'active') return;
    if (consumer.state !== 'paused') throw new CoordinatorError('INVALID_STATE');
    consumer.state = 'active';
    if (consumer.job.object) {
      // A paused result may have sat on disk for a long time: recheck bytes even for the original source.
      consumer.job.proofs.clear();
      consumer.job.proofs.set(sourceKey(consumer.spec.expected, consumer.spec.anchor), this.attestor.adopt(consumer.job.object.digest, consumer.spec.expected, consumer.spec.anchor));
      this.deliver(consumer);
    } else this.pump();
  }
  private async cancel(consumer: Consumer): Promise<void> {
    if (consumer.state === 'cancelled') return;
    if (consumer.state === 'completed') throw new CoordinatorError('CANCEL_TOO_LATE');
    if (consumer.state === 'failed') throw new CoordinatorError('INVALID_STATE');
    consumer.state = 'cancelling';
    const job = consumer.job;
    if (!this.demand(job)) job.controller?.abort();
    if (!this.demand(job)) await job.cycle;
    await consumer.delivery;
    if (consumer.failure) { if (consumer.state === 'cancelling') this.settle(consumer, 'failed', consumer.failure); throw consumer.failure; }
    if (consumer.state === 'cancelling') this.settle(consumer, 'cancelled', new DownloadError('CANCELLED'));
  }
  /** Stops admission and joins physical work plus source-proof writes before resolving. */
  async close(): Promise<void> {
    this.closed = true;
    const cancellations = await Promise.allSettled([...this.consumers.values()].map(consumer => this.cancel(consumer)));
    await Promise.all([...this.jobs.values()].map(job => job.cycle)); await Promise.all(this.deliveries);
    const failed = cancellations.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
