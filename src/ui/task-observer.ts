import type { InstanceBridge, InstanceCode, TaskSnapshot } from '../shared/contracts/instances.js';

export interface TaskObservation {
  snapshot: TaskSnapshot;
  connection: 'connecting' | 'confirmed' | 'rechecking' | 'unconfirmed' | 'unavailable';
  lastConfirmedAt?: number;
  code?: InstanceCode;
}
interface Entry {
  taskId: string; value: TaskObservation; listeners: Set<(value: TaskObservation) => void>;
  generation: number; due: number; failures: number; busy: boolean; stopped: boolean; subscribe: boolean;
  admitted: boolean;
  dispose?: () => void;
}
const terminal = (task: TaskSnapshot): boolean => ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(task.state);
const FINAL_ERRORS: readonly InstanceCode[] = ['TASK_NOT_FOUND', 'TASK_NOT_OWNED', 'ROOT_UNAVAILABLE', 'OUT_OF_SCOPE', 'INVALID_SENDER'];
const BACKOFF = [2000, 5000, 15000, 30000] as const;
// A void disposal cannot prove the remote subscription was removed. Retain every issued slot
// for the bridge lifetime, including calls whose late acknowledgement is still in flight.
const issuedSubscriptions = new WeakMap<object, number>();

/** Shares bounded, read-only task observation within one renderer root generation. Never controls a task. */
export class TaskObserverPool {
  private readonly entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  private closed = false;
  private inFlight = 0;
  private rotating: Entry | undefined;
  constructor(private readonly bridge: Pick<InstanceBridge, 'getTask' | 'subscribeTask'>, private readonly ownerKey: object = bridge) {}

  private reserveSubscription(): boolean {
    const issued = issuedSubscriptions.get(this.ownerKey) ?? 0;
    if (issued >= 8) return false;
    issuedSubscriptions.set(this.ownerKey, issued + 1); return true;
  }

  /** Multiple cards for one task share subscription, health reads and the latest non-regressing snapshot. */
  observe(initial: TaskSnapshot, listener: (value: TaskObservation) => void): { dispose(): void; reconnect(): void } {
    if (this.closed) throw new Error('OBSERVER_CLOSED');
    let entry = this.entries.get(initial.taskId);
    if (!entry) {
      entry = { taskId: initial.taskId, value: { snapshot: initial, connection: 'unconfirmed' }, listeners: new Set(),
        generation: 0, due: 0, failures: 0, busy: false, stopped: false, subscribe: !terminal(initial), admitted: false };
      this.entries.set(initial.taskId, entry);
    } else if (initial.revision > entry.value.snapshot.revision) entry.value = { ...entry.value, snapshot: initial };
    const selected = entry; selected.listeners.add(listener); listener(selected.value); this.schedule();
    return {
      dispose: () => {
        selected.listeners.delete(listener);
        if (!selected.listeners.size && this.entries.get(selected.taskId) === selected) {
          selected.generation++; selected.dispose?.(); this.entries.delete(selected.taskId);
          if (this.rotating === selected) this.rotating = undefined;
          if (!this.entries.size) { clearTimeout(this.timer); this.timer = undefined; }
        }
      },
      reconnect: () => {
        if (this.entries.get(selected.taskId) !== selected || selected.busy) return;
        selected.generation++; selected.dispose?.(); delete selected.dispose;
        selected.failures = 0; selected.stopped = false; selected.subscribe = !terminal(selected.value.snapshot); selected.due = 0;
        // An explicit query must also work for a detail waiting behind the eight-observer budget.
        const others = [...this.entries.values()].filter(entry => entry !== selected);
        this.entries.clear(); this.entries.set(selected.taskId, selected);
        for (const other of others) this.entries.set(other.taskId, other);
        this.publish(selected, { ...selected.value, connection: 'unconfirmed' }); this.schedule();
      },
    };
  }

  /** Hidden pages stop admission and release observations; returning resumes through the same global budget. */
  setVisible(visible: boolean): void {
    if (this.visible === visible || this.closed) return;
    this.visible = visible; clearTimeout(this.timer); this.timer = undefined;
    for (const entry of this.entries.values()) {
      entry.generation++; entry.dispose?.(); delete entry.dispose;
      if (!entry.stopped && !terminal(entry.value.snapshot)) {
        entry.subscribe = !terminal(entry.value.snapshot); entry.due = 0;
        this.publish(entry, { ...entry.value, connection: 'unconfirmed' });
      }
    }
    this.schedule();
  }

  /** Invalidates old-root continuations and removes timers/listeners without cancelling background work. */
  close(): void {
    this.closed = true; clearTimeout(this.timer); this.timer = undefined;
    for (const entry of this.entries.values()) { entry.generation++; entry.dispose?.(); entry.listeners.clear(); }
    this.entries.clear(); this.rotating = undefined;
  }
  private publish(entry: Entry, value: TaskObservation): void {
    entry.value = value;
    for (const listener of entry.listeners) { try { listener(value); } catch { /* One card must not break other observers. */ } }
  }
  private live(entry: Entry, generation: number): boolean {
    return !this.closed && this.visible && !entry.stopped && this.entries.get(entry.taskId) === entry && entry.generation === generation;
  }
  private confirmed(entry: Entry, snapshot: TaskSnapshot): void {
    if (snapshot.taskId !== entry.taskId) { this.failed(entry, 'UNAVAILABLE'); return; }
    // A successful stale read confirms reachability, but must not replace newer subscription facts.
    const latest = snapshot.revision >= entry.value.snapshot.revision ? snapshot : entry.value.snapshot;
    entry.failures = 0; entry.due = terminal(latest) ? Infinity : Date.now() + (latest.state === 'paused' ? 30000 : 15000);
    this.publish(entry, { snapshot: latest, connection: 'confirmed', lastConfirmedAt: Date.now() });
    if (terminal(latest)) { entry.dispose?.(); delete entry.dispose; }
  }
  private failed(entry: Entry, code: InstanceCode): void {
    entry.failures++;
    entry.stopped = FINAL_ERRORS.includes(code) || entry.failures >= 4;
    entry.due = Date.now() + BACKOFF[Math.min(entry.failures - 1, 3)]!;
    if (entry.stopped) { entry.dispose?.(); delete entry.dispose; }
    this.publish(entry, { ...entry.value, connection: entry.stopped ? 'unavailable' : 'unconfirmed', code });
  }
  private schedule(): void {
    if (this.closed || !this.visible || this.timer || !this.entries.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.tick(); }, 500);
  }
  private tick(): void {
    // Admit at most eight details, two concurrent calls, and one call per 500ms (including subscriptions).
    const eligible = [...this.entries.values()].filter(entry => !entry.stopped && (!terminal(entry.value.snapshot) || entry.due !== Infinity));
    let details: Entry[];
    if (eligible.length <= 8) { this.rotating = undefined; details = eligible; }
    else {
      const stable = eligible.slice(0, 7); const waiting = eligible.slice(7);
      const earliest = [...waiting].sort((a, b) => a.due - b.due)[0]!;
      if (!this.rotating || !waiting.includes(this.rotating) || !this.rotating.busy && earliest.due <= Date.now()) this.rotating = earliest;
      details = [...stable, this.rotating];
    }
    const admitted = details.filter(entry => !terminal(entry.value.snapshot));
    const finalReads = details.filter(entry => terminal(entry.value.snapshot));
    const allowed = new Set([...admitted, ...finalReads]);
    for (const entry of this.entries.values()) {
      if (entry.admitted && !allowed.has(entry)) {
        entry.generation++; entry.dispose?.(); delete entry.dispose;
        entry.subscribe = !terminal(entry.value.snapshot);
        if (!entry.stopped && !terminal(entry.value.snapshot)) this.publish(entry, { ...entry.value, connection: 'unconfirmed' });
      }
      entry.admitted = allowed.has(entry);
    }
    const next = [...admitted, ...finalReads].filter(entry => !entry.busy && entry.due <= Date.now()).sort((a, b) => a.due - b.due)[0];
    if (next && this.inFlight < 2) {
      next.busy = true; this.inFlight++;
      const transient = eligible.length > 8 && next === this.rotating;
      void this.read(next, transient).finally(() => { next.busy = false; this.inFlight--; });
    }
    // No timer is needed when every remaining task is terminal/blocked and no initial read is pending.
    if (admitted.length || finalReads.some(entry => !entry.stopped)) this.schedule();
  }
  private async read(entry: Entry, transient = false): Promise<void> {
    const generation = entry.generation;
    const subscribe = entry.subscribe && !transient && this.reserveSubscription();
    if (!transient) entry.subscribe = false;
    this.publish(entry, { ...entry.value, connection: subscribe ? 'connecting' : 'rechecking' });
    try {
      if (subscribe) {
        const subscription = await this.bridge.subscribeTask(entry.taskId, snapshot => {
          if (this.live(entry, generation)) this.confirmed(entry, snapshot);
        });
        if (!this.live(entry, generation)) { subscription.dispose(); return; }
        if (!subscription.result.ok) { subscription.dispose(); this.failed(entry, subscription.result.error.code); return; }
        this.confirmed(entry, subscription.result.data.snapshot);
        if (entry.stopped || terminal(entry.value.snapshot)) subscription.dispose(); else entry.dispose = subscription.dispose;
      } else {
        const result = await this.bridge.getTask(entry.taskId);
        if (!this.live(entry, generation)) return;
        if (result.ok) this.confirmed(entry, result.data.snapshot); else this.failed(entry, result.error.code);
      }
    } catch { if (this.live(entry, generation)) this.failed(entry, 'UNAVAILABLE'); }
  }
}
