import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { instanceFailure, isInstancePayload, isInstanceResult, isTaskChangedEvent, TASK_EVENT_CHANNEL } from '../shared/contracts/instances.js';
import type { InstanceBridge, InstanceChannel, InstancePayloads, InstanceResult, TaskChangedEvent, TaskSnapshot } from '../shared/contracts/instances.js';

async function request<C extends InstanceChannel>(channel: C, payload: InstancePayloads[C], requestId: string = crypto.randomUUID(),
  onLateResult?: (result: InstanceResult<C>) => void): Promise<InstanceResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isInstancePayload(payload, channel)) return instanceFailure(crypto.randomUUID(), 'INVALID_ARGUMENT', crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    // Keep observing invoke after the public deadline: a late subscription still owns main resources.
    const invocation = ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }).then((value: unknown) => {
      if (timedOut && isInstanceResult(value, requestId, channel)) onLateResult?.(value);
      return value;
    });
    const deadline = new Promise<InstanceResult<C>>(resolve => { timer = setTimeout(() => {
      timedOut = true; resolve(instanceFailure(requestId, 'TIMEOUT', requestId));
    }, 3000); });
    const result: unknown = await Promise.race([invocation, deadline]);
    return isInstanceResult(result, requestId, channel) ? result : instanceFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return instanceFailure(requestId, 'UNAVAILABLE', requestId); }
  finally { clearTimeout(timer); }
}

/** Releases only an abandoned observation; a failed cleanup gets at most one transient retry. */
async function releaseLateSubscription(subscriptionId: string): Promise<void> {
  const result = await request('events:unsubscribe', { subscriptionId });
  if (!result.ok && ['TIMEOUT', 'UNAVAILABLE'].includes(result.error.code)) await request('events:unsubscribe', { subscriptionId });
}

/** Exposes only fixed task/instance methods; renderer subscription disposal never cancels a task. */
export function createInstanceBridge(): InstanceBridge {
  return {
    listInstances: query => request('instances:list', query),
    createInstance: (requestId, input) => request('instances:create', input, requestId),
    listTasks: query => request('tasks:list', query),
    getTask: taskId => request('tasks:get', { taskId }),
    controlTask: (taskId, action) => request('tasks:control', { taskId, action }),
    async subscribeTask(taskId, listener) {
      const subscription: { id?: string } = {}; let disposed = false; let sequence = 0; let revision = 0; let overflow = false;
      const buffered: TaskChangedEvent[] = []; let bufferedBytes = 0; let refreshing = false;
      const deliver = (snapshot: TaskSnapshot): void => {
        if (disposed || snapshot.revision < revision) return;
        revision = snapshot.revision;
        try { listener(snapshot); } catch { dispose(); }
      };
      const refresh = (): void => {
        if (refreshing || disposed) return; refreshing = true;
        void request('tasks:get', { taskId }).then(result => { if (result.ok) deliver(result.data.snapshot); }).finally(() => { refreshing = false; });
      };
      const accept = (event: TaskChangedEvent): void => {
        if (event.subscriptionId !== subscription.id || event.seq <= sequence || disposed) return;
        if (event.seq !== sequence + 1) { sequence = event.seq; refresh(); return; }
        sequence = event.seq; deliver(event.payload);
      };
      const receive = (_event: unknown, value: unknown): void => {
        if (!isTaskChangedEvent(value) || value.taskId !== taskId || disposed) return;
        if (subscription.id) accept(value);
        else {
          const bytes = JSON.stringify(value).length * 2;
          if (buffered.length >= 256 || bufferedBytes + bytes > 1024 * 1024) { overflow = true; return; }
          buffered.push(value); bufferedBytes += bytes;
        }
      };
      const dispose = (): void => {
        if (disposed) return; disposed = true; buffered.length = 0; ipcRenderer.removeListener(TASK_EVENT_CHANNEL, receive);
        if (subscription.id) void request('events:unsubscribe', { subscriptionId: subscription.id });
      };
      ipcRenderer.on(TASK_EVENT_CHANNEL, receive);
      const result = await request('tasks:subscribe', { taskId }, crypto.randomUUID(), late => {
        if (late.ok && late.data.snapshot.taskId === taskId) void releaseLateSubscription(late.data.subscriptionId);
      });
      if (!result.ok) { dispose(); return { result, dispose }; }
      subscription.id = result.data.subscriptionId; sequence = result.data.seq;
      if (overflow) {
        dispose(); return { result: instanceFailure<'tasks:subscribe'>(result.requestId, 'CURSOR_EXPIRED', result.requestId), dispose };
      }
      deliver(result.data.snapshot); for (const event of buffered) accept(event); buffered.length = 0;
      return { result, dispose };
    },
  };
}
