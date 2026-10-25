import { randomUUID } from 'node:crypto';
import { GameProcessError } from '../services/launch/process.js';
import { LaunchService, LaunchServiceError } from '../services/launch/service.js';
import type { GameTaskView } from '../services/launch/service.js';
import { WorkerError } from '../services/workers/protocol.js';
import { InstanceContractError, instanceFailure } from '../shared/contracts/instances.js';
import type { InstanceCode, InstanceData, TaskSnapshot } from '../shared/contracts/instances.js';
import type { GameChannel, GameData, GameDispatcher, GamePayloads, SessionSnapshot } from '../shared/contracts/game.js';
import { isGamePayload } from '../shared/contracts/game.js';
import type { AdditionalTasks } from './installer-adapter.js';

function mapped(error: unknown): InstanceContractError {
  if (error instanceof InstanceContractError) return error;
  if (error instanceof GameProcessError || error instanceof LaunchServiceError) return new InstanceContractError(error.code === 'CANCELLED' ? 'LAUNCH_FAILED' : error.code);
  if (error instanceof WorkerError) return new InstanceContractError(error.code === 'TIMEOUT' ? 'TIMEOUT' : error.code === 'REVISION_CONFLICT' ? 'REVISION_CONFLICT' : 'NEEDS_RECOVERY');
  return new InstanceContractError('LAUNCH_FAILED');
}
function view(value: GameTaskView): InstanceData['tasks:get'] {
  const { task, session } = value; const state = task.execution.state;
  const snapshot: TaskSnapshot = { taskId: task.taskId, kind: task.kind as 'launch' | 'stop', state,
    stage: ['completed', 'cancelled', 'needsRecovery', 'committing', 'queued'].includes(state) ? state as TaskSnapshot['stage'] : state === 'failed' || state === 'failing' ? 'failed' : 'preparing',
    revision: task.execution.revision, bytesDone: 0 };
  if (['failed', 'failing', 'needsRecovery'].includes(state)) {
    const reason = session.errors?.find(item => item.taskId === task.taskId)?.code;
    const code: InstanceCode = reason === 'CANCELLED' ? 'LAUNCH_FAILED' : reason ?? (state === 'needsRecovery' ? 'NEEDS_RECOVERY' : 'LAUNCH_FAILED');
    const error = instanceFailure(randomUUID(), code, randomUUID()); if (!error.ok) snapshot.error = error.error;
  }
  return { snapshot, ...(state === 'completed' ? { result: task.kind === 'launch' ? { sessionId: session.taskId }
    : { sessionId: session.taskId, stopped: true as const, ...(session.snapshot.exitCode === undefined ? {} : { exitCode: session.snapshot.exitCode }) } } : {}) };
}
interface Cursor { sender: number; root: string; offset: number; items: SessionSnapshot[]; expires: number }
/** Projects owned game tasks/sessions into the existing task transport and strict game channels. */
export class GameAdapter implements AdditionalTasks {
  private readonly cursors = new Map<string, Cursor>();
  constructor(private readonly service: LaunchService, private readonly root: () => Promise<string>) {}
  async get(root: string, taskId: string): Promise<InstanceData['tasks:get'] | undefined> {
    if (!this.service.hasTask(root, taskId)) return undefined;
    try { const value = await this.service.task(root, taskId); return value ? view(value) : undefined; } catch (error) { throw mapped(error); }
  }
  async list(root: string): Promise<TaskSnapshot[]> { try { return (await this.service.tasks(root)).map(item => view(item).snapshot); } catch (error) { throw mapped(error); } }
  async cancel(root: string, taskId: string): Promise<void> { try { await this.service.cancel(root, taskId); } catch (error) { throw mapped(error); } }
  dispatcher(sender: number): GameDispatcher {
    return async <C extends GameChannel>(channel: C, payload: GamePayloads[C], id: string): Promise<GameData[C]> => {
      try {
        if (!isGamePayload(payload, channel)) throw new InstanceContractError('INVALID_ARGUMENT'); const root = await this.root();
        let result: GameData[GameChannel];
        if (channel === 'game:launch' && isGamePayload(payload, 'game:launch')) result = await this.service.launch(id, payload);
        else if (channel === 'game:stop' && isGamePayload(payload, 'game:stop')) result = await this.service.stop(id, payload.sessionId, payload.mode, payload.confirmed);
        else if (channel === 'sessions:get' && isGamePayload(payload, 'sessions:get')) result = await this.service.session(root, payload.sessionId.toLowerCase());
        else if (channel === 'sessions:list' && isGamePayload(payload, 'sessions:list')) {
          for (const [key, cursor] of this.cursors) if (cursor.expires <= Date.now()) this.cursors.delete(key);
          const saved = payload.cursor ? this.cursors.get(payload.cursor) : undefined;
          if (payload.cursor && (!saved || saved.root !== root)) throw new InstanceContractError('CURSOR_EXPIRED');
          if (saved && saved.sender !== sender) throw new InstanceContractError('OUT_OF_SCOPE');
          const items = saved?.items ?? (await this.service.sessions(root)).sort((a, b) => Number(['running', 'stopping'].includes(b.state)) - Number(['running', 'stopping'].includes(a.state)) || b.startedAt.localeCompare(a.startedAt));
          const offset = saved?.offset ?? 0; const next = offset + payload.limit; let nextCursor: string | undefined;
          if (next < items.length) { while (this.cursors.size >= 128) this.cursors.delete(this.cursors.keys().next().value!); nextCursor = randomUUID(); this.cursors.set(nextCursor, { sender, root, offset: next, items, expires: Date.now() + 30000 }); }
          result = { items: items.slice(offset, next), ...(nextCursor ? { nextCursor } : {}) };
        } else throw new InstanceContractError('INVALID_ARGUMENT');
        return result as GameData[C];
      } catch (error) { throw mapped(error); }
    };
  }
  removeSender(sender: number): void { for (const [id, cursor] of this.cursors) if (cursor.sender === sender) this.cursors.delete(id); }
}
