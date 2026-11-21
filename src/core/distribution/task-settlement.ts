import type { Execution } from '../task/machine.js';

/** A receipt-backed settlement is distinct from an ordinary worker progress event. */
export class TaskSettlementError extends Error {
  readonly code = 'NEEDS_RECOVERY';
  constructor() { super('NEEDS_RECOVERY'); this.name = 'TaskSettlementError'; }
}

/** Changes only state and revision. The caller must authenticate the historical transaction evidence. */
export function settleDistributionExecution(current: Execution, phase: 'committed' | 'rolledBack'): Execution {
  if (!current || !['running', 'needsRecovery'].includes(current.state) || current.attempt !== 1
    || !Number.isSafeInteger(current.revision) || current.revision < 2 || current.revision >= Number.MAX_SAFE_INTEGER - 1
    || !Number.isSafeInteger(current.lastSequence) || current.lastSequence < 0 || !Number.isSafeInteger(current.bytesDone) || current.bytesDone < 0
    || current.bytesTotal !== undefined && (!Number.isSafeInteger(current.bytesTotal) || current.bytesTotal < current.bytesDone)
    || Object.keys(current).some(key => !['state', 'attempt', 'revision', 'lastSequence', 'bytesDone', 'bytesTotal'].includes(key))
    || phase !== 'committed' && phase !== 'rolledBack') throw new TaskSettlementError();
  return { ...current, state: phase === 'committed' ? 'completed' : 'failed', revision: current.revision + 1 };
}
