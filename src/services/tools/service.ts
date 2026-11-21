import { ONLINE_TOOL_REGISTRY, validateOnlineToolRegistry } from '../../core/tools/online-policy.js';
import type { OnlineToolDefinition } from '../../core/tools/online-policy.js';

export type OnlineToolCode = 'TOOL_NOT_FOUND' | 'LOAD_FAILED' | 'VIEW_FAILED' | 'CLEANUP_FAILED';
export interface OnlineToolState {
  revision: number;
  phase: 'closed' | 'loading' | 'ready' | 'failed' | 'closing';
  toolId?: string;
  code?: OnlineToolCode;
}
export interface OnlineToolView {
  load(): Promise<void>;
  dispose(): Promise<void>;
}
export interface OnlineToolViewFactory {
  create(tool: OnlineToolDefinition, failed: () => void): OnlineToolView;
}
export class OnlineToolError extends Error {
  constructor(readonly code: OnlineToolCode) { super(code); this.name = 'OnlineToolError'; }
}

/** Owns one isolated view. Closing invalidates load callbacks immediately, before cleanup awaits. */
export class OnlineToolService {
  private readonly registry: readonly OnlineToolDefinition[];
  private snapshot: OnlineToolState = { revision: 0, phase: 'closed' };
  private generation = 0;
  private current: OnlineToolView | undefined;
  private pending: Promise<OnlineToolState> | undefined;
  private cleanup: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(state: OnlineToolState) => void>();
  constructor(private readonly factory: OnlineToolViewFactory, registry: readonly OnlineToolDefinition[] = ONLINE_TOOL_REGISTRY) {
    this.registry = validateOnlineToolRegistry(registry);
  }
  /** Local display metadata only; no URL, native handle or session escapes. */
  list(): { toolId: string; title: string }[] { return this.registry.map(({ toolId, title }) => ({ toolId, title })); }
  state(): OnlineToolState { return { ...this.snapshot }; }
  onChange(listener: (state: OnlineToolState) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(value: Omit<OnlineToolState, 'revision'>): OnlineToolState {
    this.snapshot = { ...value, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) { try { listener(this.state()); } catch { /* A failed observer cannot retain a native view. */ } }
    return this.state();
  }
  private release(): Promise<void> {
    const view = this.current; this.current = undefined;
    const previous = this.cleanup;
    // A failed destroy/cleanup quarantines this service: do not create another view beside an unknown survivor.
    this.cleanup = previous.then(async () => { if (view) await view.dispose(); });
    return this.cleanup;
  }
  /** Repeated open of the same active tool reuses the existing generation. */
  open(toolId: string): Promise<OnlineToolState> {
    const tool = this.registry.find(item => item.toolId === toolId);
    if (!tool) return Promise.reject(new OnlineToolError('TOOL_NOT_FOUND'));
    if (this.snapshot.toolId === toolId && ['loading', 'ready'].includes(this.snapshot.phase)) return this.pending ?? Promise.resolve(this.state());
    const ticket = ++this.generation;
    this.publish({ phase: 'loading', toolId });
    const valid = (): boolean => ticket === this.generation;
    const opening = (async () => {
      try {
        await this.release();
        if (!valid()) return this.state();
        const view = this.factory.create(tool, () => {
          // Factories may report an immediate failure during construction; own the returned view before cleanup.
          queueMicrotask(() => { if (valid()) void this.fail(ticket, toolId); });
        });
        this.current = view;
        await view.load();
        if (valid()) this.publish({ phase: 'ready', toolId });
      } catch {
        if (valid()) await this.fail(ticket, toolId);
      }
      return this.state();
    })();
    this.pending = opening;
    void opening.finally(() => { if (this.pending === opening) this.pending = undefined; });
    return opening;
  }
  private async fail(ticket: number, toolId: string): Promise<void> {
    if (ticket !== this.generation) return;
    ++this.generation;
    let code: OnlineToolCode = 'LOAD_FAILED';
    try { await this.release(); } catch { code = 'CLEANUP_FAILED'; }
    if (this.generation === ticket + 1) this.publish({ phase: 'failed', toolId, code });
  }
  /** Retry never accepts a new URL and always allocates a new isolated partition. */
  async retry(): Promise<OnlineToolState> {
    const toolId = this.snapshot.toolId;
    if (!toolId) throw new OnlineToolError('TOOL_NOT_FOUND');
    const ticket = this.generation + 1;
    await this.close();
    if (this.generation !== ticket) return this.state();
    return this.open(toolId);
  }
  /** Call before local dialogs, page departure, document reload, or owner teardown. */
  async close(): Promise<OnlineToolState> {
    const ticket = ++this.generation;
    this.publish({ phase: 'closing' });
    try {
      await this.release();
      if (ticket === this.generation) this.publish({ phase: 'closed' });
    } catch {
      if (ticket === this.generation) this.publish({ phase: 'failed', code: 'CLEANUP_FAILED' });
    }
    return this.state();
  }
}
