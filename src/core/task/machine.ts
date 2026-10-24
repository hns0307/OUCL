/** Internal execution states; projecting IPC snapshots is the service's responsibility. */
export type TaskState = 'queued' | 'running' | 'verifying' | 'committing' | 'pausing' | 'paused'
  | 'cancelling' | 'cancelled' | 'completed' | 'failing' | 'failed' | 'needsRecovery';
export interface Execution {
  state: TaskState;
  attempt: number;
  lastSequence: number;
  revision: number;
  bytesDone: number;
  bytesTotal?: number;
}
export type TaskEffect = 'start' | 'pause' | 'cleanup' | 'verify' | 'commit' | 'recover';
export interface Transition { execution: Execution; effects: TaskEffect[]; rejected?: 'INVALID_TASK_STATE' | 'CANCEL_TOO_LATE' }
export type TaskCommand = 'start' | 'pause' | 'resume' | 'cancel' | 'retry' | 'interrupted';
export type WorkerEvent = { attempt: number; sequence: number } & (
  { kind: 'progress'; bytesDone: number; bytesTotal?: number }
  | { kind: 'transferred' | 'verified' | 'committed' | 'paused' | 'cleaned' | 'failed' }
);

/** Constructs a deterministic initial execution without clocks or IO. */
export function createExecution(): Execution {
  return { state: 'queued', attempt: 0, lastSequence: 0, revision: 1, bytesDone: 0 };
}

function unchanged(execution: Execution, rejected?: Transition['rejected']): Transition {
  return rejected ? { execution, effects: [], rejected } : { execution, effects: [] };
}

function move(execution: Execution, state: TaskState, effects: TaskEffect[] = []): Transition {
  return { execution: { ...execution, state, revision: execution.revision + 1 }, effects };
}

/** Requests effects only. The owner must durably record the transition before executing them. */
export function controlTask(execution: Execution, command: TaskCommand): Transition {
  const state = execution.state;
  if (command === 'interrupted') {
    if (['running', 'verifying', 'committing', 'pausing', 'cancelling', 'failing'].includes(state)) return move(execution, 'needsRecovery', ['recover']);
    return unchanged(execution);
  }
  if (command === 'cancel') {
    if (state === 'committing' || state === 'completed') return unchanged(execution, 'CANCEL_TOO_LATE');
    if (state === 'cancelling' || state === 'cancelled') return unchanged(execution);
    if (state === 'needsRecovery') return unchanged(execution, 'INVALID_TASK_STATE');
    return move(execution, 'cancelling', ['cleanup']);
  }
  if (command === 'pause') {
    if (state === 'paused' || state === 'pausing') return unchanged(execution);
    if (state === 'queued') return move(execution, 'paused');
    if (state === 'running') return move(execution, 'pausing', ['pause']);
    return unchanged(execution, 'INVALID_TASK_STATE');
  }
  if (command === 'resume' && state === 'paused') return move(execution, 'queued');
  if (command === 'retry' && state === 'failed') return move(execution, 'queued');
  if (command === 'start' && state === 'queued') {
    return { execution: { state: 'running', attempt: execution.attempt + 1, lastSequence: 0,
      revision: execution.revision + 1, bytesDone: 0 }, effects: ['start'] };
  }
  return unchanged(execution, 'INVALID_TASK_STATE');
}

/** Drops old attempts, out-of-order events and illegal transitions, including cancel/finish races. */
export function applyWorkerEvent(execution: Execution, event: WorkerEvent): Transition {
  if (event.attempt !== execution.attempt || !Number.isSafeInteger(event.sequence)
    || event.sequence <= execution.lastSequence) return unchanged(execution);
  const base = { ...execution, lastSequence: event.sequence };
  if (event.kind === 'progress' && execution.state === 'running') {
    const total = event.bytesTotal ?? execution.bytesTotal;
    if (!Number.isSafeInteger(event.bytesDone) || event.bytesDone < execution.bytesDone
      || (total !== undefined && (!Number.isSafeInteger(total) || total < event.bytesDone
        || (execution.bytesTotal !== undefined && total !== execution.bytesTotal)))) return unchanged(execution);
    const next: Execution = { ...base, bytesDone: event.bytesDone, revision: base.revision + 1 };
    if (total !== undefined) next.bytesTotal = total;
    return { execution: next, effects: [] };
  }
  if (event.kind === 'transferred' && execution.state === 'running') return move(base, 'verifying', ['verify']);
  if (event.kind === 'verified' && execution.state === 'verifying') return move(base, 'committing', ['commit']);
  if (event.kind === 'committed' && execution.state === 'committing') return move(base, 'completed');
  if (event.kind === 'paused' && execution.state === 'pausing') return move(base, 'paused');
  if (event.kind === 'cleaned' && execution.state === 'cancelling') return move(base, 'cancelled');
  if (event.kind === 'cleaned' && execution.state === 'failing') return move(base, 'failed');
  if (event.kind === 'failed' && ['running', 'verifying', 'pausing'].includes(execution.state)) return move(base, 'failing', ['cleanup']);
  // Failed commit/cleanup has uncertain disk state; never claim a safe terminal result.
  if (event.kind === 'failed' && ['committing', 'cancelling', 'failing'].includes(execution.state)) return move(base, 'needsRecovery', ['recover']);
  return unchanged(execution);
}
