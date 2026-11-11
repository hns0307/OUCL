import type { PackData } from '../../shared/contracts/packs.js';
import type { FixedPackPreview } from '../../core/packs/fixed-preview.js';

interface Pending { id: string; controller: AbortController; promise: Promise<PackData> }
/** Keeps a chooser owned until it actually settles and drains only the sender's worker on destruction. */
export class FixedPackCoordinator {
  private readonly pending = new Map<number, Pending>();
  private workerActive = false;
  constructor(private readonly preview: (file: string, signal: AbortSignal) => Promise<FixedPackPreview>) {}
  removeSender(sender: number): void { this.pending.get(sender)?.controller.abort(); }
  inspect(sender: number, id: string, trusted: () => boolean, choose: () => Promise<string | undefined>): Promise<PackData> {
    const existing = this.pending.get(sender);
    if (existing) return existing.id === id ? existing.promise : Promise.reject(new Error('UNAVAILABLE'));
    if (this.pending.size >= 16) return Promise.reject(new Error('UNAVAILABLE'));
    const controller = new AbortController();
    const promise = (async (): Promise<PackData> => {
      if (!trusted()) throw new Error('INVALID_SENDER');
      const file = await choose();
      if (controller.signal.aborted || !trusted()) throw new Error('INVALID_SENDER');
      if (!file) return { state: 'cancelled' };
      if (this.workerActive) throw new Error('UNAVAILABLE');
      this.workerActive = true;
      try {
        const result = await this.preview(file, controller.signal);
        if (controller.signal.aborted || !trusted()) throw new Error('INVALID_SENDER');
        return { state: 'preview', preview: result };
      } finally { this.workerActive = false; }
    })();
    const pending = { id, controller, promise }; this.pending.set(sender, pending);
    void promise.finally(() => { if (this.pending.get(sender) === pending) this.pending.delete(sender); }).catch(() => {});
    return promise;
  }
}
