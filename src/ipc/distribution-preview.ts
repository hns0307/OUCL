import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { distributionFailure, isDistributionQuery, isDistributionResult } from '../shared/contracts/distribution-preview.js';
import type { DistributionChannel, DistributionPublicCode, DistributionQuery, DistributionResult, DistributionSummary } from '../shared/contracts/distribution-preview.js';

export interface DistributionPreviewPort {
  listSources(): Array<{ sourceId: string }>;
  preview(query: DistributionQuery, signal: AbortSignal): Promise<DistributionSummary>;
}
/** Sender-owned, bounded read-only jobs. Cancelling releases observation, never mutates player files. */
export class DistributionPreviewAdapter {
  private readonly jobs = new Map<string, { digest: string; controller: AbortController; result: Promise<DistributionResult> }>();
  private disposed = false;
  constructor(private readonly port: DistributionPreviewPort) {}
  async handle(channel: DistributionChannel, input: unknown, trusted: () => boolean, trace: string): Promise<DistributionResult> {
    const shape = exactObject(input, ['contractVersion', 'requestId', 'payload']);
    const id = shape && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : trace;
    if (this.disposed || !trusted()) return distributionFailure(id, 'INVALID_SENDER', trace);
    if (shape && typeof input.contractVersion === 'number' && input.contractVersion > 1) return distributionFailure(id, 'UNSUPPORTED_CONTRACT', trace);
    if (!shape || input.contractVersion !== 1 || input.requestId !== id) return distributionFailure(id, 'INVALID_ARGUMENT', trace);
    if (channel === 'distribution:sources') {
      if (!exactObject(input.payload, [])) return distributionFailure(id, 'INVALID_ARGUMENT', trace);
      try {
        const result: DistributionResult = { contractVersion: 1, requestId: id, ok: true, data: { sources: this.port.listSources() } };
        return isDistributionResult(result, id, channel) ? result : distributionFailure(id, 'UNAVAILABLE', trace);
      } catch { return distributionFailure(id, 'UNAVAILABLE', trace); }
    }
    if (channel === 'distribution:cancel') {
      if (!exactObject(input.payload, ['previewRequestId']) || typeof input.payload.previewRequestId !== 'string' || !UUID_PATTERN.test(input.payload.previewRequestId)) return distributionFailure(id, 'INVALID_ARGUMENT', trace);
      const job = this.jobs.get(input.payload.previewRequestId); if (job) job.controller.abort();
      // Joining means cancellation is settled, not merely requested.
      if (job) await job.result;
      return this.disposed || !trusted() ? distributionFailure(id, 'INVALID_SENDER', trace) : { contractVersion: 1, requestId: id, ok: true, data: { cancelled: Boolean(job) } };
    }
    if (!isDistributionQuery(input.payload)) return distributionFailure(id, 'INVALID_ARGUMENT', trace);
    const query = input.payload; const digest = JSON.stringify([query.rootId, query.instanceId, query.sourceId, query.packageId, query.packageVersion]);
    const previous = this.jobs.get(id);
    if (previous) return previous.digest === digest ? previous.result : distributionFailure(id, 'REQUEST_CONFLICT', trace);
    if (this.jobs.size >= 16) return distributionFailure(id, 'PREVIEW_LIMIT', trace);
    const controller = new AbortController();
    const result = this.run(query, id, trace, controller.signal, trusted);
    this.jobs.set(id, { digest, controller, result }); return result;
  }
  private async run(query: DistributionQuery, id: string, trace: string, signal: AbortSignal, trusted: () => boolean): Promise<DistributionResult> {
    try {
      const preview = await this.port.preview(query, signal);
      if (this.disposed || !trusted()) return distributionFailure(id, 'INVALID_SENDER', trace);
      if (signal.aborted) return distributionFailure(id, 'CANCELLED', trace);
      const result: DistributionResult = { contractVersion: 1, requestId: id, ok: true, data: { preview } };
      return isDistributionResult(result, id, 'distribution:preview') ? result : distributionFailure(id, 'UNAVAILABLE', trace);
    } catch (error) {
      const code = signal.aborted ? 'CANCELLED' : error instanceof Error ? error.message : '';
      const allowed: DistributionPublicCode[] = ['SOURCE_UNAVAILABLE', 'UNTRUSTED_DISTRIBUTION', 'TARGET_MISMATCH', 'FILES_CHANGED', 'UNSAFE_FILES', 'PREVIEW_LIMIT', 'PREVIEW_BUSY', 'CANCELLED'];
      return distributionFailure(id, allowed.includes(code as DistributionPublicCode) ? code as DistributionPublicCode : 'UNAVAILABLE', trace);
    }
  }
  /** Document changes revoke every pending job before any late reply can be admitted. */
  dispose(): void { this.disposed = true; for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear(); }
  /** Shutdown joins cancelled reads before storage and network adapters are released. */
  async close(): Promise<void> { const pending = [...this.jobs.values()].map(job => job.result); this.dispose(); await Promise.allSettled(pending); }
}
