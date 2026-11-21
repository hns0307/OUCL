import { randomUUID } from 'node:crypto';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { InstanceContractError, instanceFailure, isInstancePayload, isInstanceSummary, isTaskSnapshot, isInstanceData } from '../shared/contracts/instances.js';
import type { InstanceChannel, InstanceCode, InstanceData, InstanceDispatcher, InstancePayloads, InstanceSummary, InstallStage, TaskChangedEvent, TaskSnapshot } from '../shared/contracts/instances.js';
import type { InstallerService } from '../services/install/installer.js';
import { InstallerError } from '../services/install/installer.js';
import { WorkerError } from '../services/workers/protocol.js';
import type { Installation } from '../services/storage/installation.js';
import type { RecordEnvelope } from '../services/storage/records.js';

type Service = Pick<InstallerService, 'create' | 'list' | 'task' | 'cancel'>;
type TaskView = Awaited<ReturnType<Service['task']>>;
export interface AdditionalTasks {
  get(root: string, taskId: string): Promise<InstanceData['tasks:get'] | undefined>;
  list(root: string): Promise<TaskSnapshot[]>;
  cancel(root: string, taskId: string): Promise<void>;
}
type Send = (event: TaskChangedEvent) => void;
interface Subscription { id: string; sender: number; root: string; task: string; seq: number; snapshot: TaskSnapshot; send: Send }
interface Cursor { sender: number; root: string; channel: 'instances:list' | 'tasks:list'; filter: string; items: InstanceSummary[] | TaskSnapshot[]; offset: number; expires: number }
const STAGES: readonly InstallStage[] = ['metadata', 'downloading', 'materializing', 'committing', 'completed', 'failed', 'cancelled', 'needsRecovery', 'queued'];
const code = (error: unknown): InstanceCode => {
  if (error instanceof InstanceContractError) return error.code;
  if (error instanceof InstallerError) {
    if (error.code === 'INSTANCE_NOT_FOUND') return 'TASK_NOT_FOUND';
    if (error.code === 'CANCELLED') return 'INSTALL_FAILED';
    return error.code;
  }
  if (error instanceof WorkerError) {
    if (error.code === 'TIMEOUT') return 'TIMEOUT';
    if (['NEEDS_RECOVERY', 'INVALID_RECORD', 'UNSAFE_PATH'].includes(error.code)) return 'NEEDS_RECOVERY';
    if (error.code === 'STORE_BUSY') return 'ROOT_UNAVAILABLE';
    return 'TASK_STORE_UNAVAILABLE';
  }
  return 'UNAVAILABLE';
};
function stage(value: TaskView): InstallStage {
  if (value.stage === 'installer') return 'metadata';
  if (value.stage === 'processors') return 'materializing';
  if (STAGES.includes(value.stage as InstallStage)) return value.stage as InstallStage;
  switch (value.task.execution.state) {
    case 'queued': return 'queued';
    case 'committing': return 'committing';
    case 'completed': return 'completed';
    case 'failed': case 'failing': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'needsRecovery': return 'needsRecovery';
    case 'verifying': return 'materializing';
    default: return 'downloading';
  }
}
function taskSnapshot(value: TaskView, root: string, taskId: string): TaskSnapshot {
  if (value.task.ownerId.toLowerCase() !== root) throw new InstanceContractError('TASK_NOT_OWNED');
  if (value.task.kind !== 'install' || value.task.taskId.toLowerCase() !== taskId.toLowerCase()) throw new InstanceContractError('TASK_NOT_FOUND');
  const execution = value.task.execution; const result: TaskSnapshot = { taskId, kind: 'install', state: execution.state,
    stage: stage(value), revision: execution.revision, bytesDone: execution.bytesDone,
    ...(execution.bytesTotal === undefined ? {} : { bytesTotal: execution.bytesTotal }) };
  if (execution.state === 'failed' || execution.state === 'failing' || execution.state === 'needsRecovery') {
    const failure = instanceFailure(randomUUID(), execution.state === 'needsRecovery' ? 'NEEDS_RECOVERY' : 'INSTALL_FAILED', randomUUID());
    if (!failure.ok) result.error = failure.error;
  }
  if (!isTaskSnapshot(result)) throw new InstanceContractError('TASK_STORE_UNAVAILABLE'); return result;
}
function publicSummary(value: Awaited<ReturnType<Service['list']>>[number]): InstanceSummary {
  const result: InstanceSummary = { instanceId: value.instanceId, displayName: value.displayName, mcVersionId: value.mcVersionId,
    isolation: value.isolation, state: value.state, revision: value.revision };
  if (!isInstanceSummary(result)) throw new InstanceContractError('NEEDS_RECOVERY'); return result;
}

/** Projects private installation state into the approved path-free instance/task DTOs and bounded subscriptions. */
export class InstallerAdapter {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly tombstones = new Map<string, number>();
  private readonly cursors = new Map<string, Cursor>();
  private readonly generations = new Map<number, symbol>();
  private readonly pending = new Map<number, number>();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private closed = false;
  constructor(private readonly service: Service, private readonly roots: { readInstallation(): Promise<RecordEnvelope<Installation> | undefined> }, private readonly additional?: AdditionalTasks) {}
  private async publicTask(root: string, taskId: string): Promise<InstanceData['tasks:get']> {
    const extra = await this.additional?.get(root, taskId.toLowerCase());
    if (extra) { if (!isInstanceData(extra, 'tasks:get') || extra.snapshot.taskId.toLowerCase() !== taskId.toLowerCase()) throw new InstanceContractError('TASK_STORE_UNAVAILABLE'); return extra; }
    const value = await this.service.task(root, taskId.toLowerCase()); const snapshot = taskSnapshot(value, root, taskId);
    const instance = value.instance;
    if (instance && (instance.rootId.toLowerCase() !== root || instance.taskId.toLowerCase() !== taskId.toLowerCase())) throw new InstanceContractError('TASK_NOT_OWNED');
    return { snapshot, ...(snapshot.state === 'completed' && instance ? { result: { instanceId: instance.instanceId } } : {}) };
  }

  /** Binds event delivery to one validated webContents identity; sender removal invalidates in-flight admission. */
  dispatcher(senderId: number, send: Send): InstanceDispatcher {
    if (!Number.isSafeInteger(senderId) || senderId < 1) throw new InstanceContractError('INVALID_SENDER');
    const generation = this.generations.get(senderId) ?? Symbol(); this.generations.set(senderId, generation);
    return async <C extends InstanceChannel>(channel: C, payload: InstancePayloads[C], requestId: string): Promise<InstanceData[C]> => {
      try {
        this.available(senderId, generation);
        if (!UUID_PATTERN.test(requestId) || !isInstancePayload(payload, channel)) throw new InstanceContractError('INVALID_ARGUMENT');
        return await this.dispatch(senderId, generation, send, channel, payload, requestId) as InstanceData[C];
      } catch (error) { throw new InstanceContractError(code(error)); }
    };
  }
  private available(sender: number, generation: symbol): void {
    if (this.closed) throw new InstanceContractError('UNAVAILABLE');
    if (this.generations.get(sender) !== generation) throw new InstanceContractError('INVALID_SENDER');
  }
  private async root(): Promise<string> {
    const installation = await this.roots.readInstallation(); const id = installation?.data.rootId;
    if (!id || !UUID_PATTERN.test(id)) throw new InstanceContractError('ROOT_UNAVAILABLE'); return id.toLowerCase();
  }
  private page<T extends InstanceSummary | TaskSnapshot>(sender: number, root: string, channel: Cursor['channel'], filter: string,
    query: { cursor?: string; limit: number }, items: T[]): { items: T[]; nextCursor?: string } {
    for (const [id, cursor] of this.cursors) if (cursor.expires <= Date.now()) this.cursors.delete(id);
    let offset = 0; let all = items;
    if (query.cursor) {
      const saved = this.cursors.get(query.cursor);
      if (!saved || saved.channel !== channel || saved.filter !== filter || saved.root !== root) throw new InstanceContractError('CURSOR_EXPIRED');
      if (saved.sender !== sender) throw new InstanceContractError('OUT_OF_SCOPE');
      offset = saved.offset; all = saved.items as T[];
    }
    const selected = all.slice(offset, offset + query.limit); offset += selected.length;
    if (offset >= all.length) return { items: selected };
    while (this.cursors.size >= 256) this.cursors.delete(this.cursors.keys().next().value!);
    const nextCursor = randomUUID(); this.cursors.set(nextCursor, { sender, root, channel, filter, items: all as Cursor['items'], offset, expires: Date.now() + 30000 });
    return { items: selected, nextCursor };
  }
  private async dispatch(sender: number, generation: symbol, send: Send, channel: InstanceChannel, payload: InstancePayloads[InstanceChannel], requestId: string): Promise<InstanceData[InstanceChannel]> {
    if (channel === 'events:unsubscribe' && isInstancePayload(payload, channel)) {
      const subscriptionId = payload.subscriptionId.toLowerCase();
      const owner = this.subscriptions.get(subscriptionId)?.sender ?? this.tombstones.get(subscriptionId);
      if (owner !== undefined && owner !== sender) throw new InstanceContractError('SUBSCRIPTION_NOT_OWNED');
      const removed = this.subscriptions.has(subscriptionId); this.remove(subscriptionId); return { removed };
    }
    const root = await this.root(); this.available(sender, generation);
    if (channel === 'instances:list' && isInstancePayload(payload, channel)) {
      if (payload.rootId.toLowerCase() !== root) throw new InstanceContractError('OUT_OF_SCOPE');
      const items = payload.cursor ? [] : (await this.service.list(root)).filter(item => item.rootId.toLowerCase() === root).map(publicSummary);
      this.available(sender, generation); return this.page(sender, root, channel, '', payload, items);
    }
    if (channel === 'instances:create' && isInstancePayload(payload, channel)) {
      if (payload.rootId.toLowerCase() !== root) throw new InstanceContractError('OUT_OF_SCOPE');
      return await this.service.create(requestId, { ...payload, rootId: root });
    }
    if (channel === 'tasks:list' && isInstancePayload(payload, channel)) {
      const items: TaskSnapshot[] = [];
      if (!payload.cursor) {
        const summaries = await this.service.list(root); const seen = new Set<string>();
        for (const item of summaries) {
          if (item.rootId.toLowerCase() !== root || seen.has(item.taskId)) continue; seen.add(item.taskId);
          const snapshot = taskSnapshot(await this.service.task(root, item.taskId), root, item.taskId);
          if (payload.state === undefined || payload.state === snapshot.state) items.push(snapshot);
        }
        for (const snapshot of await this.additional?.list(root) ?? []) if (payload.state === undefined || payload.state === snapshot.state) items.push(snapshot);
      }
      this.available(sender, generation); return this.page(sender, root, channel, payload.state ?? '', payload, items);
    }
    if (channel === 'tasks:get' && isInstancePayload(payload, channel)) {
      return this.publicTask(root, payload.taskId);
    }
    if (channel === 'tasks:control' && isInstancePayload(payload, channel)) {
      const current = (await this.publicTask(root, payload.taskId)).snapshot;
      if (payload.action !== 'cancel') throw new InstanceContractError('INVALID_TASK_STATE');
      if (current.kind === 'install') await this.service.cancel(root, payload.taskId.toLowerCase()); else await this.additional?.cancel(root, payload.taskId.toLowerCase());
      const snapshot = (await this.publicTask(root, payload.taskId)).snapshot;
      return { taskId: payload.taskId, accepted: true, state: snapshot.state };
    }
    if (channel === 'tasks:subscribe' && isInstancePayload(payload, channel)) {
      if (payload.afterSeq !== undefined && payload.afterSeq > 0) throw new InstanceContractError('CURSOR_EXPIRED');
      const own = [...this.subscriptions.values()].filter(item => item.sender === sender).length + (this.pending.get(sender) ?? 0);
      const total = this.subscriptions.size + [...this.pending.values()].reduce((a, b) => a + b, 0);
      if (own >= 64 || total >= 256) throw new InstanceContractError('UNAVAILABLE');
      this.pending.set(sender, (this.pending.get(sender) ?? 0) + 1);
      try {
        const snapshot = (await this.publicTask(root, payload.taskId)).snapshot; this.available(sender, generation);
        const id = randomUUID(); this.subscriptions.set(id, { id, sender, root, task: payload.taskId, seq: 0, snapshot, send }); this.start();
        return { subscriptionId: id, snapshot, seq: 0 };
      } finally { const count = (this.pending.get(sender) ?? 1) - 1; if (count > 0) this.pending.set(sender, count); else this.pending.delete(sender); }
    }
    throw new InstanceContractError('INVALID_ARGUMENT');
  }
  private start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      if (this.polling) return; this.polling = true;
      void this.poll().catch(() => {}).finally(() => { this.polling = false; });
    }, 100); this.timer.unref();
  }
  private async poll(): Promise<void> {
    if (this.closed || this.subscriptions.size === 0) return;
    const root = await this.root(); const queried = new Map<string, Promise<InstanceData['tasks:get']>>();
    for (const subscription of [...this.subscriptions.values()]) {
      if (this.closed || !this.subscriptions.has(subscription.id)) continue;
      if (subscription.root !== root) { this.remove(subscription.id); continue; }
      try {
        const taskId = subscription.task.toLowerCase();
        let query = queried.get(taskId); if (!query) { query = this.publicTask(root, taskId); queried.set(taskId, query); }
        const snapshot = (await query).snapshot;
        if (this.closed || this.subscriptions.get(subscription.id) !== subscription) continue;
        if (snapshot.revision === subscription.snapshot.revision && snapshot.stage === subscription.snapshot.stage) continue;
        subscription.snapshot = snapshot; subscription.seq++;
        try { subscription.send({ contractVersion: 1, subscriptionId: subscription.id, seq: subscription.seq, taskId: snapshot.taskId, revision: snapshot.revision, kind: 'task:changed', payload: snapshot }); }
        catch { this.remove(subscription.id); }
      } catch (error) {
        if (['TASK_NOT_OWNED', 'TASK_NOT_FOUND'].includes(code(error))) this.remove(subscription.id);
        else if (!(error instanceof InstallerError) && !(error instanceof WorkerError) && !(error instanceof InstanceContractError)) this.remove(subscription.id);
      }
    }
  }
  private remove(id: string): void {
    const subscription = this.subscriptions.get(id); if (!subscription) return;
    this.subscriptions.delete(id); this.tombstones.set(id, subscription.sender);
    while (this.tombstones.size > 1024) this.tombstones.delete(this.tombstones.keys().next().value!);
    if (this.subscriptions.size === 0 && this.timer) { clearInterval(this.timer); delete this.timer; }
  }
  /** Window destruction only removes observation state; it never cancels installation tasks. */
  removeSender(senderId: number): void {
    this.generations.delete(senderId);
    for (const subscription of this.subscriptions.values()) if (subscription.sender === senderId) this.remove(subscription.id);
    for (const [id, cursor] of this.cursors) if (cursor.sender === senderId) this.cursors.delete(id);
  }
  /** Stops timers and delivery only; InstallerService owns effect cancellation and shutdown order. */
  close(): void {
    this.closed = true; if (this.timer) clearInterval(this.timer); delete this.timer;
    this.subscriptions.clear(); this.cursors.clear(); this.tombstones.clear(); this.generations.clear();
  }
}
