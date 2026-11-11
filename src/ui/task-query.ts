import type { InstanceBridge, InstanceCode, InstanceError, InstanceSummary, Page, TaskSnapshot } from '../shared/contracts/instances.js';

export const ACTIVE_TASK_STATES = ['queued', 'running', 'verifying', 'committing', 'pausing', 'paused', 'cancelling', 'failing'] as const;
/** Needs recovery is a separate pending action, not an active transfer. */
export function activeTask(task: TaskSnapshot): boolean { return ACTIVE_TASK_STATES.some(state => task.state === state); }

interface ReadJob { valid(): boolean; start(): void; abandon(): void }
/** Renderer-wide list/detail budget: two in flight and one admission per 500ms. */
export class TaskReadBudget {
  private readonly queue: ReadJob[] = [];
  private inFlight = 0;
  private nextStart = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  run<T>(work: () => Promise<T>, valid: () => boolean = () => true): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.queue.push({ valid, abandon: () => { resolve(undefined); }, start: () => {
        this.inFlight++; this.nextStart = Date.now() + 500;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => { this.inFlight--; this.pump(); });
      } }); this.pump();
    });
  }
  private pump(): void {
    if (this.timer) return;
    while (this.queue.length && !this.queue[0]!.valid()) this.queue.shift()!.abandon();
    if (!this.queue.length || this.inFlight >= 2) return;
    const delay = Math.max(0, this.nextStart - Date.now());
    if (delay) { this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, delay); return; }
    this.queue.shift()!.start(); this.pump();
  }
}
export const rendererTaskReads = new TaskReadBudget();

type PageResult<T> = { ok: true; data: Page<T> } | { ok: false; error: InstanceError };
class PageReader<T extends { revision: number }> {
  readonly items = new Map<string, T>();
  cursor: string | undefined;
  done = false;
  error: InstanceCode | undefined;
  private restarted = false;
  private retryCursor = false;
  constructor(private readonly identity: (item: T) => string, private readonly query: (cursor?: string) => Promise<PageResult<T>>) {}
  async next(): Promise<void> {
    this.retryCursor = false;
    try {
      const result = await this.query(this.cursor);
      if (!result.ok) {
        this.error = result.error.code;
        if (result.error.code === 'CURSOR_EXPIRED' && !this.restarted) {
          this.restarted = true; this.cursor = undefined; this.items.clear();
          this.retryCursor = true;
        }
        return;
      }
      this.error = undefined;
      for (const item of result.data.items) {
        const key = this.identity(item).toLowerCase(); const previous = this.items.get(key);
        if (!previous || item.revision >= previous.revision) this.items.set(key, item);
      }
      this.cursor = result.data.nextCursor; this.done = !this.cursor;
    } catch { this.error = 'UNAVAILABLE'; }
  }
  get readable(): boolean { return !this.done && (!this.error || this.retryCursor); }
  get restarting(): boolean { return this.retryCursor; }
  get hasRestarted(): boolean { return this.restarted && this.error === undefined; }
}
export interface TaskQueryView {
  tasks: TaskSnapshot[]; instances: InstanceSummary[];
  tasksComplete: boolean; instancesComplete: boolean; historyComplete: boolean; historyRestarted: boolean; error: InstanceCode | undefined;
}
/** Bounded read-only query session. Each batch continues existing cursors and never replays a write. */
export class TaskQuerySession {
  private readonly active: PageReader<TaskSnapshot>[];
  private readonly history: PageReader<TaskSnapshot>;
  private readonly instances: PageReader<InstanceSummary>;
  private readonly known: Map<string, TaskSnapshot>;
  private readonly confirmed = new Map<string, TaskSnapshot>();
  private readonly checked = new Set<string>();
  private unresolved = false;
  private conflict = false;
  private readonly conflictKeys = new Set<string>();
  private historyStarted = false;
  private unfilteredComplete = false;
  constructor(private readonly bridge: Pick<InstanceBridge, 'listTasks' | 'listInstances' | 'getTask'>, rootId: string, previous: TaskSnapshot[] = []) {
    this.known = new Map(previous.map(task => [task.taskId.toLowerCase(), task]));
    this.active = [...ACTIVE_TASK_STATES, 'needsRecovery' as const].map(state => new PageReader(task => task.taskId,
      cursor => bridge.listTasks({ limit: 100, state, ...(cursor ? { cursor } : {}) })));
    this.history = new PageReader(task => task.taskId, cursor => bridge.listTasks({ limit: 100, ...(cursor ? { cursor } : {}) }));
    this.instances = new PageReader(item => item.instanceId, cursor => bridge.listInstances({ rootId, limit: 100, ...(cursor ? { cursor } : {}) }));
  }
  async load(valid: () => boolean, historyMore = false): Promise<TaskQueryView> {
    const started = Date.now(); let calls = 0;
    const pages = new Map<object, number>();
    const allowed = (): boolean => valid() && calls < 40 && Date.now() - started < 10000;
    const read = async <T extends { revision: number }>(reader: PageReader<T>): Promise<boolean> => {
      if (!allowed() || !reader.readable || (pages.get(reader) ?? 0) >= 20) return false;
      calls++; pages.set(reader, (pages.get(reader) ?? 0) + 1); await reader.next();
      // History is read once per explicit batch, so an expired cursor must retry here rather than
      // waiting for the active-state round robin (which never advances the history reader).
      if (reader.restarting && allowed() && (pages.get(reader) ?? 0) < 20) {
        calls++; pages.set(reader, (pages.get(reader) ?? 0) + 1); await reader.next();
      }
      return true;
    };
    // A small complete snapshot is cheaper than nine filtered scans (the adapter reads all domains per filter).
    // Larger histories still get every active/recovery filter before any filter receives page two.
    if (!this.historyStarted) {
      if (await read(this.history)) this.historyStarted = true;
      if (!this.history.done) await read(this.history);
      this.unfilteredComplete = this.history.done;
    }
    if (historyMore) { if (await read(this.history)) this.historyStarted = true; }
    this.unfilteredComplete = this.history.done;
    let progressed = true;
    while (allowed() && progressed) {
      progressed = false;
      if (!this.unfilteredComplete) for (const reader of this.active) if (await read(reader)) progressed = true;
      if (await read(this.instances)) progressed = true;
    }
    const listed = new Map([...this.active.flatMap(reader => [...reader.items]),
      ...(this.unfilteredComplete ? [...this.history.items].filter(([, item]) => activeTask(item) || item.state === 'needsRecovery') : [])]);
    this.view();
    this.unresolved = false;
    const candidates = new Map([...this.known, ...listed]);
    for (const [key, old] of candidates) {
      const needsRead = this.conflictKeys.has(key) || (activeTask(old) || old.state === 'needsRecovery') && !listed.has(key);
      if (!needsRead || this.checked.has(key)) continue;
      if (!allowed()) { this.unresolved = true; continue; }
      calls++;
      try {
        const result = await this.bridge.getTask(old.taskId);
        if (result.ok && result.data.snapshot.taskId.toLowerCase() === key) { this.confirmed.set(key, result.data.snapshot); this.checked.add(key); }
        else this.unresolved = true;
      } catch { this.unresolved = true; }
    }
    return this.view();
  }
  view(): TaskQueryView {
    const merged = new Map(this.known); this.conflictKeys.clear();
    for (const task of [...this.history.items.values(), ...this.active.flatMap(reader => [...reader.items.values()]), ...this.confirmed.values()]) {
      const key = task.taskId.toLowerCase(), previous = merged.get(key);
      if (previous && task.revision === previous.revision && (previous.state !== task.state || previous.stage !== task.stage
        || previous.kind !== task.kind || previous.bytesDone !== task.bytesDone || previous.bytesTotal !== task.bytesTotal || previous.error?.code !== task.error?.code)) this.conflictKeys.add(key);
      if (!previous || task.revision >= previous.revision) merged.set(key, task);
    }
    for (const [key, task] of this.confirmed) if (task.revision >= (merged.get(key)?.revision ?? 0)) this.conflictKeys.delete(key);
    this.conflict = this.conflictKeys.size > 0;
    return { tasks: [...merged.values()], instances: [...this.instances.items.values()],
      tasksComplete: (this.unfilteredComplete || this.active.every(reader => reader.done)) && !this.unresolved && !this.conflict,
      instancesComplete: this.instances.done, historyComplete: this.history.done, historyRestarted: this.history.hasRestarted,
      error: [...this.active, this.instances, this.history].find(reader => reader.error)?.error };
  }
}
