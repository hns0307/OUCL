import { setTimeout } from 'node:timers/promises';
/** Bounded, cancellable backoff. The timer listener is removed on both completion and cancellation. */
export async function retryDelay(attempt: number, signal?: AbortSignal, retryAfterMs = 0): Promise<void> {
  await setTimeout(Math.max(250 * 2 ** attempt, retryAfterMs), undefined, { signal });
}
