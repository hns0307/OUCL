import { randomUUID } from 'node:crypto';
import { isModCode, ModContractError } from '../../shared/contracts/mods.js';
import { isMaintenanceDisplay } from '../../shared/contracts/mod-maintenance-preview.js';
import type { PreviewCode, PreviewInput, PreviewSnapshot, PreviewStatus } from '../../shared/contracts/mod-maintenance-preview.js';
import type { ModMaintenancePreviewService } from './maintenance-preview.js';
import { presentMaintenancePreview } from './maintenance-presentation.js';

interface Job { id: string; requestId: string; input: PreviewInput; status: PreviewStatus; result: PreviewSnapshot['result'];
  errorCode: PreviewCode | null; controller: AbortController; done: Promise<void>; finish: () => void; finishedAt: number | null }
const RETENTION_MS = 15 * 60 * 1000;
/** Ephemeral, bounded and serialized observations. No preview is a filesystem mutation permit. */
export class MaintenancePreviewJobs {
  private readonly jobs = new Map<string, Job>(); private readonly requests = new Map<string, string>(); private readonly expired = new Set<string>();
  private active: Job | undefined; private closed = false;
  constructor(private readonly service: Pick<ModMaintenancePreviewService, 'preview'>, private readonly now: () => number = () => performance.now()) {}
  private prune(): void {
    const now = this.now();
    for (const [id, job] of this.jobs) if (job.finishedAt !== null && now - job.finishedAt >= RETENTION_MS) {
      // Retain bounded tombstones so a late retry cannot silently start another scan.
      if (this.expired.size >= 4096) continue;
      this.expired.add(job.requestId);
      this.jobs.delete(id); this.requests.delete(job.requestId);
    }
  }
  /** Idempotent admission, with no eviction of an unexpired observation. */
  start(requestId: string, input: PreviewInput): { previewId: string } {
    if (this.closed) throw new ModContractError('UNAVAILABLE'); this.prune();
    const request = requestId.toLowerCase(); const canonical: PreviewInput = { rootId: input.rootId.toLowerCase(), instanceId: input.instanceId.toLowerCase(),
      expectedRevision: input.expectedRevision, expectedFingerprint: input.expectedFingerprint, fileId: input.fileId, action: input.action };
    if (this.expired.has(request)) throw new PreviewExpiredError();
    const prior = this.requests.get(request);
    if (prior) {
      const job = this.jobs.get(prior)!;
      if (job.finishedAt !== null && this.now() - job.finishedAt >= RETENTION_MS) throw new PreviewExpiredError();
      if (JSON.stringify(job.input) !== JSON.stringify(canonical)) throw new ModContractError('INVALID_ARGUMENT');
      return { previewId: prior };
    }
    if (this.jobs.size >= 16 || this.expired.size >= 4096) throw new ModContractError('SCAN_BUSY');
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const job: Job = { id: randomUUID(), requestId: request, input: structuredClone(canonical), status: 'queued', result: null, errorCode: null,
      controller: new AbortController(), done, finish, finishedAt: null };
    this.jobs.set(job.id, job); this.requests.set(request, job.id); queueMicrotask(() => { this.pump(); }); return { previewId: job.id };
  }
  private terminal(job: Job, state: 'completed' | 'cancelled' | 'failed'): void {
    job.status = state; job.finishedAt = this.now(); job.finish();
  }
  private pump(): void {
    if (this.closed || this.active) return;
    const job = [...this.jobs.values()].find(item => item.status === 'queued'); if (!job) return;
    this.active = job; job.status = 'running';
    void (async () => {
      try {
        const preview = await this.service.preview(job.input, job.controller.signal);
        if (job.controller.signal.aborted) this.terminal(job, 'cancelled');
        else {
          const result = presentMaintenancePreview(preview);
          if (!isMaintenanceDisplay(result)) throw new ModContractError('MOD_LIMIT');
          job.result = result; this.terminal(job, 'completed');
        }
      } catch (error) {
        if (job.controller.signal.aborted) this.terminal(job, 'cancelled');
        else { job.errorCode = typeof error === 'object' && error !== null && 'code' in error && isModCode(error.code) ? error.code : 'SCAN_FAILED'; this.terminal(job, 'failed'); }
      } finally { this.active = undefined; this.pump(); }
    })();
  }
  /** Unknown/expired IDs deliberately share the same error and reveal no other observation. */
  get(previewId: string): PreviewSnapshot {
    this.prune(); const job = this.jobs.get(previewId.toLowerCase());
    if (!job || job.finishedAt !== null && this.now() - job.finishedAt >= RETENTION_MS) throw new PreviewExpiredError();
    return structuredClone({ previewId: job.id, status: job.status, result: job.result, errorCode: job.errorCode });
  }
  /** Running cancellation waits until the scanner has actually exited. */
  async cancel(previewId: string): Promise<{ previewId: string; status: PreviewStatus }> {
    this.prune(); const job = this.jobs.get(previewId.toLowerCase());
    if (!job || job.finishedAt !== null && this.now() - job.finishedAt >= RETENTION_MS) throw new PreviewExpiredError();
    if (job.status === 'queued') this.terminal(job, 'cancelled');
    else if (job.status === 'running') { job.controller.abort(); await job.done; }
    return { previewId: job.id, status: job.status };
  }
  /** Drains in-flight observation work before dependencies shut down. */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') this.terminal(job, 'cancelled');
      else if (job.status === 'running') job.controller.abort();
    }
    await Promise.all([...this.jobs.values()].map(job => job.done));
  }
}
export class PreviewExpiredError extends Error { readonly code = 'PREVIEW_EXPIRED'; constructor() { super('PREVIEW_EXPIRED'); } }
