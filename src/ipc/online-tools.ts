import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isOnlineToolPayload, isOnlineToolsData, onlineToolFailure } from '../shared/contracts/online-tools.js';
import type { OnlineToolChannel, OnlineToolsData, OnlineToolsResult } from '../shared/contracts/online-tools.js';

export interface OnlineToolPort {
  list(): Array<{ toolId: string; title: string }>;
  state(): OnlineToolsData['snapshot'];
  open(toolId: string): Promise<OnlineToolsData['snapshot']>;
  retry(): Promise<OnlineToolsData['snapshot']>;
  close(): Promise<OnlineToolsData['snapshot']>;
}
/** One adapter per trusted document; mutation IDs are bounded and never silently evicted. */
export class OnlineToolsAdapter {
  private readonly requests = new Map<string, { digest: string; job: Promise<OnlineToolsResult> }>();
  private disposed = false;
  constructor(private readonly service: OnlineToolPort) {}
  async handle(channel: OnlineToolChannel, input: unknown, trusted: () => boolean, trace: string): Promise<OnlineToolsResult> {
    const shape = exactObject(input, ['contractVersion', 'requestId', 'payload']);
    const id = shape && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : trace;
    if (this.disposed || !trusted()) return onlineToolFailure(id, 'INVALID_SENDER', trace);
    if (shape && typeof input.contractVersion === 'number' && input.contractVersion > 1) return onlineToolFailure(id, 'UNSUPPORTED_CONTRACT', trace);
    if (!shape || input.contractVersion !== 1 || input.requestId !== id || !isOnlineToolPayload(channel, input.payload)) return onlineToolFailure(id, 'INVALID_ARGUMENT', trace);
    const digest = JSON.stringify([channel, input.payload]);
    if (channel !== 'tools:state') {
      const previous = this.requests.get(id);
      if (previous) return previous.digest === digest ? previous.job : onlineToolFailure(id, 'REQUEST_CONFLICT', trace);
      if (this.requests.size >= 128 && channel !== 'tools:close') return onlineToolFailure(id, 'UNAVAILABLE', trace);
    }
    const job = this.run(channel, input.payload.toolId, id, trace, trusted);
    if (channel !== 'tools:state' && this.requests.size < 128) this.requests.set(id, { digest, job });
    return job;
  }
  private async run(channel: OnlineToolChannel, toolId: string | undefined, id: string, trace: string, trusted: () => boolean): Promise<OnlineToolsResult> {
    try {
      if (channel === 'tools:open') await this.service.open(toolId!);
      else if (channel === 'tools:retry') await this.service.retry();
      else if (channel === 'tools:close') await this.service.close();
      if (this.disposed || !trusted()) { await this.service.close(); return onlineToolFailure(id, 'INVALID_SENDER', trace); }
      const data = { tools: this.service.list(), snapshot: this.service.state() };
      return isOnlineToolsData(data) ? { contractVersion: 1, requestId: id, ok: true, data } : onlineToolFailure(id, 'UNAVAILABLE', trace);
    } catch (error) { return onlineToolFailure(id, error instanceof Error && error.message === 'TOOL_NOT_FOUND' ? 'TOOL_NOT_FOUND' : 'UNAVAILABLE', trace); }
  }
  /** Detach the prior document before closing its view; pending replies cannot revive ownership. */
  async dispose(): Promise<void> { this.disposed = true; this.requests.clear(); await this.service.close(); }
}
