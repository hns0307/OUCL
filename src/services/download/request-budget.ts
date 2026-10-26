import { DownloadError } from './types.js';
interface Waiting { host: string; start(): void; cancel(): void }
/** Bounds live HTTP bodies across all files; queued cancellation never consumes a connection. */
export class RequestBudget {
  private active = 0;
  private readonly hosts = new Map<string, number>();
  private readonly queue: Waiting[] = [];
  constructor(private readonly total = 16, private readonly perHost = 8) {
    if (![total, perHost].every(Number.isSafeInteger) || total < 1 || total > 64 || perHost < 1 || perHost > total) throw new DownloadError('INVALID_TRANSFER');
  }
  async run<T>(host: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(host, signal);
    try { if (signal?.aborted) throw new DownloadError('CANCELLED'); return await work(); }
    finally { release(); }
  }
  private acquire(host: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new DownloadError('CANCELLED'));
    if (this.queue.length >= 256) return Promise.reject(new DownloadError('TRANSFER_BUSY'));
    return new Promise((resolve, reject) => {
      const item: Waiting = { host, start: () => {
        signal?.removeEventListener('abort', item.cancel); this.active++; this.hosts.set(host, (this.hosts.get(host) ?? 0) + 1);
        let released = false; resolve(() => { if (released) return; released = true; this.active--; const remaining = (this.hosts.get(host) ?? 1) - 1; if (remaining) this.hosts.set(host, remaining); else this.hosts.delete(host); this.pump(); });
      }, cancel: () => { const index = this.queue.indexOf(item); if (index >= 0) this.queue.splice(index, 1); signal?.removeEventListener('abort', item.cancel); reject(new DownloadError('CANCELLED')); this.pump(); } };
      this.queue.push(item); signal?.addEventListener('abort', item.cancel, { once: true });
      if (signal?.aborted) item.cancel(); else this.pump();
    });
  }
  private pump(): void {
    for (let index = 0; index < this.queue.length && this.active < this.total;) {
      const item = this.queue[index]!;
      if ((this.hosts.get(item.host) ?? 0) >= this.perHost) { index++; continue; }
      this.queue.splice(index, 1); item.start();
    }
  }
}
