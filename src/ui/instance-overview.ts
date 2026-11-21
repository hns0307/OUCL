import type { InstanceSummary, TaskSnapshot } from '../shared/contracts/instances.js';
import type { SessionSnapshot } from '../shared/contracts/game.js';
import type { TargetBridge, TargetRow } from '../shared/contracts/task-targets.js';
import type { MessageKey } from '../shared/locales/messages.js';

export interface OverviewTasks {
  connection: 'loading' | 'confirmed' | 'unavailable';
  rows: TargetRow[];
  partial: boolean;
  error?: MessageKey;
}

/** Reads only the approved Mod target query; invalidation never controls a running task. */
export class InstanceOverviewReader {
  private generation = 0;
  private closed = false;
  constructor(private readonly instanceId: string, private readonly bridge: TargetBridge,
    private readonly publish: (value: OverviewTasks) => void) {}

  /** One bounded page per explicit refresh. Late refreshes or disposed instance replies are ignored. */
  async refresh(): Promise<void> {
    if (this.closed) return;
    const ticket = ++this.generation;
    const valid = (): boolean => !this.closed && ticket === this.generation;
    this.publish({ connection: 'loading', rows: [], partial: true });
    try {
      const result = await this.bridge.listInstanceTaskTargets({ instanceId: this.instanceId, kinds: ['mod-check', 'mod-install'], limit: 20 });
      if (!valid()) return;
      if (!result.ok) {
        this.publish({ connection: 'unavailable', rows: [], partial: true, error: result.error.messageKey }); return;
      }
      // Public preload also checks ownership. Keep the renderer projection strict when injected/test adapters are used.
      if (result.data.items.some(row => row.instanceId.toLowerCase() !== this.instanceId.toLowerCase()
        || row.task.kind !== 'mod-check' && row.task.kind !== 'mod-install')) throw new Error('UNCONFIRMED_TARGET');
      this.publish({ connection: 'confirmed', rows: result.data.items, partial: result.data.nextCursor !== undefined });
    } catch {
      if (valid()) this.publish({ connection: 'unavailable', rows: [], partial: true, error: 'unavailable' });
    }
  }

  /** Prevents all pending replies from being published after root or instance changes. */
  close(): void { this.closed = true; this.generation++; }
}

/** Selects a real session for this instance, preferring ongoing sessions over historical exits. */
export function overviewSession(instanceId: string, sessions: readonly SessionSnapshot[]): SessionSnapshot | undefined {
  return sessions.filter(session => session.instanceId.toLowerCase() === instanceId.toLowerCase()).sort((a, b) => {
    const ongoing = Number(b.state !== 'exited') - Number(a.state !== 'exited');
    return ongoing || b.startedAt.localeCompare(a.startedAt) || b.revision - a.revision;
  })[0];
}

/** Uses global snapshots only to advance an already-proven task identity; never infers instance ownership. */
export function overviewTaskRows(rows: readonly TargetRow[], tasks: readonly TaskSnapshot[]): TargetRow[] {
  const snapshots = new Map(tasks.map(task => [task.taskId.toLowerCase(), task]));
  return rows.map(row => {
    const task = snapshots.get(row.task.taskId.toLowerCase());
    return task && task.kind === row.task.kind && task.revision > row.task.revision ? { ...row, task } : row;
  });
}

/** Inherited isolation is deliberately not resolved without the effective setting. */
export function overviewIsolation(instance: InstanceSummary): MessageKey {
  return instance.isolation === 'inherit' ? 'overviewIsolationInherit' : instance.isolation === 'off' ? 'uiShared' : 'uiIsolated';
}
