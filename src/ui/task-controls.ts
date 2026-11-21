import type { TaskSnapshot } from '../shared/contracts/instances.js';
import type { TaskObservation } from './task-observer.js';

/** Offer cancellation only while an observed task is before its irreversible/cleanup boundary. */
export function canRequestTaskCancellation(task: TaskSnapshot, connection: TaskObservation['connection']): boolean {
  return connection === 'confirmed' && ['queued', 'running', 'verifying', 'pausing', 'paused'].includes(task.state);
}
