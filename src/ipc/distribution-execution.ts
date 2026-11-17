import { createHash, randomUUID } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { DISTRIBUTION_EXECUTION_CHANNELS, DISTRIBUTION_EXECUTION_MAX_ACTIVE, DISTRIBUTION_EXECUTION_MAX_SEEN,
  distributionExecutionFailure, isDistributionExecutionRequest, isDistributionExecutionResult } from '../shared/contracts/distribution-execution.js';
import type { DistributionExecutionChannel, DistributionExecutionCode, DistributionExecutionRequest,
  DistributionExecutionResult } from '../shared/contracts/distribution-execution.js';

/** Future main-owned document facade; dispatch returns the complete contract result envelope.
 * Durable idempotency and commit/cancel policy belong to this facade, never to transport caches. */
export interface DistributionExecutionPort {
  available(): boolean;
  dispatch(channel: DistributionExecutionChannel, request: DistributionExecutionRequest, signal: AbortSignal): Promise<unknown>;
  revoke(): void;
  close(): Promise<void>;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
function trustedNow(trusted: () => boolean): boolean { try { return trusted() === true; } catch { return false; } }
/** Redacted failures also validate correlation IDs supplied by an invalid caller. */
export function distributionExecutionTransportFailure(input: unknown, code: DistributionExecutionCode, trace: string): DistributionExecutionResult {
  const safeTrace = uuid(trace) ? trace : randomUUID();
  let requestId = safeTrace;
  try { if (exactObject(input, ['contractVersion', 'requestId', 'payload']) && uuid(input.requestId)) requestId = input.requestId; } catch { /* invalid input */ }
  return distributionExecutionFailure(requestId, code, safeTrace);
}
interface Active { controller: AbortController; result: Promise<DistributionExecutionResult> }

/** One bounded transport per trusted document. Completed requests retain only a digest, never response bodies. */
export class DistributionExecutionAdapter {
  private readonly seen = new Map<string, string>();
  private readonly active = new Map<string, Active>();
  private disposed = false;
  private revokeFailed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly port?: DistributionExecutionPort) {}

  private available(): boolean { try { return this.port?.available() === true; } catch { return false; } }

  handle(channel: DistributionExecutionChannel, input: unknown, trusted: () => boolean, trace: string): Promise<DistributionExecutionResult> {
    const failure = (code: DistributionExecutionCode): Promise<DistributionExecutionResult> => Promise.resolve(distributionExecutionTransportFailure(input, code, trace));
    if (this.disposed || !trustedNow(trusted)) return failure('INVALID_SENDER');
    let request: DistributionExecutionRequest;
    try {
      if (!DISTRIBUTION_EXECUTION_CHANNELS.some(value => value === channel)) return failure('INVALID_ARGUMENT');
      if (exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.contractVersion === 'number' && input.contractVersion > 1) return failure('UNSUPPORTED_CONTRACT');
      if (!isDistributionExecutionRequest(input, channel)) return failure('INVALID_ARGUMENT');
      request = structuredClone(input);
    } catch { return failure('INVALID_ARGUMENT'); }
    if (!this.available()) return failure('SOURCE_UNAVAILABLE');
    const digest = createHash('sha256').update(JSON.stringify([channel,
      Object.entries(request.payload).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)])).digest('hex');
    const old = this.seen.get(request.requestId);
    if (old !== undefined && old !== digest) return failure('REQUEST_CONFLICT');
    const pending = this.active.get(request.requestId);
    if (pending) return pending.result;
    if (this.active.size >= DISTRIBUTION_EXECUTION_MAX_ACTIVE || old === undefined && this.seen.size >= DISTRIBUTION_EXECUTION_MAX_SEEN) return failure('CAPACITY_EXCEEDED');
    this.seen.set(request.requestId, digest);
    const controller = new AbortController();
    // Reserve the active slot before invoking any potentially reentrant main-owned port.
    const result = Promise.resolve().then(() => this.run(channel, request, trusted, trace, controller.signal))
      .finally(() => { this.active.delete(request.requestId); });
    this.active.set(request.requestId, { controller, result });
    return result;
  }

  private async run(channel: DistributionExecutionChannel, request: DistributionExecutionRequest,
    trusted: () => boolean, trace: string, signal: AbortSignal): Promise<DistributionExecutionResult> {
    const failure = (code: DistributionExecutionCode): DistributionExecutionResult => distributionExecutionTransportFailure(request, code, trace);
    try {
      if (this.disposed || !trustedNow(trusted)) return failure('INVALID_SENDER');
      if (!this.available() || !this.port) return failure('SOURCE_UNAVAILABLE');
      const value: unknown = await this.port.dispatch(channel, structuredClone(request), signal);
      if (this.disposed || !trustedNow(trusted)) return failure('INVALID_SENDER');
      if (signal.aborted) return failure('CANCELLED');
      if (!isDistributionExecutionResult(value, request, channel)) return failure('UNAVAILABLE');
      return structuredClone(value);
    } catch {
      return failure(this.disposed || !trustedNow(trusted) ? 'INVALID_SENDER' : signal.aborted ? 'CANCELLED' : 'UNAVAILABLE');
    }
  }

  /** Revocation is synchronous; aborted work stays tracked until its actual promise settles. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.active.values()) job.controller.abort();
    try { this.port?.revoke(); } catch { this.revokeFailed = true; }
  }

  /** Idempotently joins all work before closing the facade; abort alone is never treated as completion. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.dispose();
    const pending = [...this.active.values()].map(job => job.result);
    this.closing = (async () => {
      const results = await Promise.allSettled(pending);
      let failed = this.revokeFailed || results.some(result => result.status === 'rejected');
      try { await this.port?.close(); } catch { failed = true; }
      this.seen.clear();
      if (failed) throw new Error('UNAVAILABLE');
    })();
    return this.closing;
  }
}
