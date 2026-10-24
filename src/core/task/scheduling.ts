export interface Consumer { id: string; state: 'active' | 'paused' }
export type ConsumerAction = { kind: 'attach' | 'pause' | 'resume' | 'detach'; id: string };

/** Fixed policy failure without retaining task identifiers or paths. */
export class TaskPolicyError extends Error {
  readonly category = 'validation';
  constructor(readonly code: 'INVALID_CONSUMER' | 'CONSUMER_LIMIT' | 'CONSUMER_NOT_FOUND' | 'INVALID_SCHEDULE' | 'DUPLICATE_TASK') {
    super(code); this.name = 'TaskPolicyError';
  }
}

/** Changes one consumer's demand; unsubscribing UI events must never call this function. */
export function changeConsumer(consumers: readonly Consumer[], action: ConsumerAction): Consumer[] {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(action.id)) throw new TaskPolicyError('INVALID_CONSUMER');
  const found = consumers.find(item => item.id === action.id);
  if (action.kind === 'attach') {
    if (found) return [...consumers];
    if (consumers.length >= 1024) throw new TaskPolicyError('CONSUMER_LIMIT');
    return [...consumers, { id: action.id, state: 'active' }];
  }
  if (action.kind === 'detach') return consumers.filter(item => item.id !== action.id);
  if (!found) throw new TaskPolicyError('CONSUMER_NOT_FOUND');
  return consumers.map(item => item.id === action.id ? { ...item, state: action.kind === 'pause' ? 'paused' : 'active' } : item);
}

/** Active demand keeps a shared transfer alive even when a different installer cancels. */
export function transferDemand(consumers: readonly Consumer[]): 'run' | 'pause' | 'cancel' {
  if (!consumers.length) return 'cancel';
  return consumers.some(item => item.state === 'active') ? 'run' : 'pause';
}

export interface ScheduledTask { id: string; state: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled'; dependencies: readonly string[] }

/** Selects a stable bounded batch; missing/failed/cyclic dependencies never become runnable. */
export function scheduleTasks(tasks: readonly ScheduledTask[], concurrency: number): string[] {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32 || tasks.length > 10000) throw new TaskPolicyError('INVALID_SCHEDULE');
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new TaskPolicyError('DUPLICATE_TASK');
  const available = Math.max(0, concurrency - tasks.filter(task => task.state === 'active').length);
  return tasks.filter(task => task.state === 'queued'
    && task.dependencies.every(id => byId.get(id)?.state === 'completed')).slice(0, available).map(task => task.id);
}
