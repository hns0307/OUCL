import { DistributionExecutionAdapter, distributionExecutionTransportFailure } from './distribution-execution.js';
import type { DistributionExecutionChannel, DistributionExecutionResult } from '../shared/contracts/distribution-execution.js';

/** Document generations retain closing adapters until actual settlement, without retaining completed generations. */
export class DistributionExecutionOwners {
  private readonly live = new Map<number, DistributionExecutionAdapter>();
  private readonly retired = new Set<Promise<void>>();
  private failed = false;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly factory: () => DistributionExecutionAdapter) {}

  handle(senderId: number, channel: DistributionExecutionChannel, input: unknown,
    trusted: () => boolean, trace: string): Promise<DistributionExecutionResult> {
    let permitted = false;
    try { permitted = trusted() === true; } catch { /* untrusted document */ }
    if (this.closed || !Number.isSafeInteger(senderId) || senderId < 1 || !permitted) {
      return Promise.resolve(distributionExecutionTransportFailure(input, 'INVALID_SENDER', trace));
    }
    let adapter = this.live.get(senderId);
    if (!adapter) {
      try { adapter = this.factory(); } catch { return Promise.resolve(distributionExecutionTransportFailure(input, 'UNAVAILABLE', trace)); }
      this.live.set(senderId, adapter);
    }
    return adapter.handle(channel, input, trusted, trace);
  }

  /** Detach the old generation before a new document with the same sender ID can be admitted. */
  revoke(senderId: number): void {
    const adapter = this.live.get(senderId);
    if (!adapter) return;
    this.live.delete(senderId);
    let closing: Promise<void>;
    try { closing = adapter.close(); } catch { this.failed = true; return; }
    const tracked = closing.then(() => { this.retired.delete(tracked); }, () => {
      this.failed = true; this.retired.delete(tracked);
    });
    this.retired.add(tracked);
  }

  /** Shutdown stops new owners and joins both live and previously retired document generations. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const senderId of this.live.keys()) this.revoke(senderId);
    this.closing = Promise.all([...this.retired]).then(() => { if (this.failed) throw new Error('UNAVAILABLE'); });
    return this.closing;
  }
}
