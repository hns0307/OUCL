import { createHash } from 'node:crypto';
import { totalmem } from 'node:os';
import { controlTask, applyWorkerEvent } from '../../core/task/machine.js';
import type { Execution, WorkerEvent } from '../../core/task/machine.js';
import { planOfflineLaunch, LaunchPlanError } from '../../core/launch/plan.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { StoredTask } from '../storage/tasks.js';
import type { InstallerService } from '../install/installer.js';
import type { ProfileService } from './profiles.js';
import { GameProcessService, GameProcessError } from './process.js';
import type { GameSession } from './process.js';
import { LAUNCH_ERRORS } from '../storage/game-sessions.js';
import type { GameSessions, LaunchFailure, SavedSession } from '../storage/game-sessions.js';
import type { RecordEnvelope } from '../storage/records.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import type { JavaRuntimeService } from '../java/runtime.js';

export interface LaunchRequest { instanceId: string; accountId: string; expectedRevision: number }
interface Job { task: StoredTask; controller: AbortController; changes: Promise<void>; done: Promise<void> }
export interface GameTaskView { task: StoredTask; session: SavedSession }
export class LaunchServiceError extends Error { constructor(readonly code: LaunchFailure | 'CANCEL_TOO_LATE' | 'INVALID_TASK_STATE') { super(code); this.name = 'LaunchServiceError'; } }
const failure = (error: unknown): LaunchFailure => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (LAUNCH_ERRORS.includes(code as LaunchFailure)) return code as LaunchFailure;
  if (code === 'ENOENT' || code === 'INSTANCE_NOT_FOUND') return 'DEPENDENCY_MISSING';
  return error instanceof LaunchPlanError && error.code === 'MEMORY_OUT_OF_RANGE' ? 'MEMORY_OUT_OF_RANGE' : 'LAUNCH_FAILED';
};

/** Connects durable launch/stop tasks, trusted profiles, verified installation inputs and actual owned JVM sessions. */
export class LaunchService {
  private registry: RecordEnvelope<GameSessions> | undefined;
  private indexTail: Promise<void> = Promise.resolve();
  private admissionTail: Promise<void> = Promise.resolve();
  private readonly jobs = new Map<string, Job>();
  private readonly owned = new Set<string>();
  private readonly observers = new Set<Promise<void>>();
  private closed = false;
  private idleListener?: () => void;
  constructor(private readonly storage: StorageClient, private readonly profiles: Pick<ProfileService, 'list'>,
    private readonly installer: Pick<InstallerService, 'prepareLaunch'>, private readonly processes = new GameProcessService(), private readonly physicalMemory = totalmem,
    private readonly javaRuntime?: Pick<JavaRuntimeService, 'ensure'>) {}

  /** Normal restart preserves exited history. A previous running record cannot become an owned process by PID guesswork. */
  async initialize(): Promise<void> {
    this.registry = await this.storage.readGameSessions();
    for (const session of this.registry?.data.items ?? []) if (['running', 'stopping'].includes(session.snapshot.state)) {
      await this.save(session.taskId, current => ({ ...current!, snapshot: { ...current!.snapshot, state: 'unknown', revision: current!.snapshot.revision + 1 } }));
    }
  }
  private async root(): Promise<string> {
    const root = await this.storage.readInstallation(); if (!root) throw new GameProcessError('LAUNCH_FAILED'); return root.data.rootId;
  }
  private records(): SavedSession[] { return this.registry?.data.items ?? []; }
  private save(taskId: string, update: (current: SavedSession | undefined) => SavedSession): Promise<SavedSession> {
    const operation = this.indexTail.then(async () => {
      const items = this.records(); const previous = items.find(item => item.taskId === taskId); const next = update(previous);
      if (!previous && items.length >= 1000) throw new GameProcessError('LAUNCH_FAILED');
      if (previous && JSON.stringify(previous) === JSON.stringify(next)) return previous;
      this.registry = await this.storage.writeGameSessions(this.registry?.revision ?? 0, { items: [...items.filter(item => item.taskId !== taskId), next] });
      return next;
    });
    this.indexTail = operation.then(() => {}, () => {}); return operation;
  }
  private admitted(action: () => Promise<{ taskId: string }>): Promise<{ taskId: string }> {
    const operation = this.admissionTail.then(async () => { if (this.closed) throw new GameProcessError('LAUNCH_FAILED'); return action(); });
    this.admissionTail = operation.then(() => {}, () => {}); return operation;
  }
  /** A repeated business request returns the same durable task/session; changed content is rejected by SQLite. */
  launch(requestId: string, input: LaunchRequest): Promise<{ taskId: string }> {
    if (![requestId, input.instanceId, input.accountId].every(id => UUID_PATTERN.test(id)) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) return Promise.reject(new GameProcessError('LAUNCH_FAILED'));
    const canonical = { instanceId: input.instanceId.toLowerCase(), accountId: input.accountId.toLowerCase(), expectedRevision: input.expectedRevision };
    return this.admitted(async () => {
      const rootId = await this.root(); const task = await this.storage.accept(rootId, requestId.toLowerCase(), 'launch', createHash('sha256').update(JSON.stringify(canonical)).digest('hex'));
      if (task.execution.state !== 'queued' || this.jobs.has(task.taskId)) return { taskId: task.taskId };
      await this.save(task.taskId, current => current ?? { rootId, taskId: task.taskId, spawned: false, stopTaskIds: [], snapshot: {
        sessionId: task.taskId, instanceId: canonical.instanceId, state: 'unknown', revision: 1, startedAt: new Date().toISOString() } });
      this.start(task, async job => {
        const accountData = await this.profiles.list(); const account = accountData.accounts.find(item => item.accountId === canonical.accountId);
        if (!account) throw new LaunchServiceError('AUTH_REQUIRED');
        if (2048 * 1024 ** 2 > this.physicalMemory() * 0.75) throw new LaunchPlanError('MEMORY_OUT_OF_RANGE');
        const record = await this.storage.readInstance(canonical.instanceId);
        if (!record || record.data.summary.rootId !== rootId || record.data.phase !== 'ready') throw new GameProcessError('LAUNCH_FAILED');
        if (record.revision !== canonical.expectedRevision) throw new LaunchServiceError('REVISION_CONFLICT');
        const verified = await this.installer.prepareLaunch(canonical.instanceId, canonical.expectedRevision, job.controller.signal);
        this.check(job);
        const java = this.javaRuntime ? await this.javaRuntime.ensure(verified.prepared.version.javaMajor, task.taskId, job.controller.signal)
          : accountData.javas.find(item => item.javaId === accountData.selectedJavaId);
        if (!java) throw new GameProcessError('JAVA_INCOMPATIBLE');
        this.check(job);
        const plan = planOfflineLaunch({ version: verified.prepared.version, layout: verified.layout, classpath: verified.prepared.plan.classpath,
          java: { javaId: java.javaId, major: java.major, architecture: 'x64' }, account, assets: verified.prepared.assets, memoryMiB: (await this.storage.readSettings())?.data.memoryMiB ?? 2048, launcherVersion: '0.3.0' });
        await this.event(job, 'transferred'); this.check(job); await this.event(job, 'verified');
        const session = await this.processes.launch(canonical.instanceId, java.executable, java.major, plan,
          { signal: job.controller.signal, sessionId: task.taskId, initialRevision: 2 });
        this.owned.add(session.sessionId); this.observe(session.sessionId);
        await this.save(task.taskId, current => ({ ...current!, spawned: true, snapshot: current!.snapshot.revision > session.revision ? current!.snapshot : session }));
        await this.event(job, 'committed');
      }); return { taskId: task.taskId };
    });
  }
  /** Stop is a separate durable task; only a confirmed force request can terminate an owned JVM. */
  stop(requestId: string, sessionId: string, mode: 'graceful' | 'force', confirmed: boolean): Promise<{ taskId: string }> {
    if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(sessionId)) return Promise.reject(new GameProcessError('LAUNCH_FAILED'));
    if (!confirmed) return Promise.reject(new GameProcessError('CONFIRMATION_REQUIRED'));
    if (mode !== 'force') return Promise.reject(new GameProcessError('STOP_UNSUPPORTED'));
    return this.admitted(async () => {
      const rootId = await this.root(); const session = this.records().find(item => item.rootId === rootId && item.taskId === sessionId.toLowerCase());
      if (!session) throw new GameProcessError('SESSION_NOT_FOUND');
      const task = await this.storage.accept(rootId, requestId.toLowerCase(), 'stop', createHash('sha256').update(JSON.stringify({ sessionId: session.taskId, mode, confirmed })).digest('hex'));
      if (task.execution.state !== 'queued' || this.jobs.has(task.taskId)) return { taskId: task.taskId };
      await this.save(session.taskId, current => {
        if (current!.stopTaskIds.includes(task.taskId)) return current!;
        if (current!.stopTaskIds.length >= 16) throw new GameProcessError('LAUNCH_FAILED');
        return { ...current!, stopTaskIds: [...current!.stopTaskIds, task.taskId] };
      });
      this.start(task, async job => {
        await this.event(job, 'transferred'); this.check(job); await this.event(job, 'verified');
        const current = await this.session(rootId, session.taskId);
        const exited = current.state === 'exited' ? current : await this.processes.stop(session.taskId, mode, confirmed);
        if (exited.state !== 'exited') throw new GameProcessError('NEEDS_RECOVERY');
        await this.save(session.taskId, latest => ({ ...latest!, snapshot: exited })); await this.event(job, 'committed');
      }); return { taskId: task.taskId };
    });
  }
  private start(task: StoredTask, action: (job: Job) => Promise<void>): void {
    const job: Job = { task, controller: new AbortController(), changes: Promise.resolve(), done: Promise.resolve() }; this.jobs.set(task.taskId, job);
    job.done = (async () => {
      try { await this.change(job, state => controlTask(state, 'start').execution); this.check(job); await action(job); }
      catch (error) {
        const saved = this.records().find(item => item.taskId === task.taskId || item.stopTaskIds.includes(task.taskId));
        const reason = job.controller.signal.aborted ? 'CANCELLED' : failure(error);
        if (saved) await this.save(saved.taskId, current => ({ ...current!, errors: [...(current!.errors ?? []).filter(item => item.taskId !== task.taskId), { taskId: task.taskId, code: reason }] }));
        if (this.owned.has(task.taskId) || reason === 'NEEDS_RECOVERY') await this.change(job, state => controlTask(state, 'interrupted').execution);
        else { if (reason !== 'CANCELLED') await this.event(job, 'failed'); await this.event(job, 'cleaned'); }
      }
    })().finally(() => { this.jobs.delete(task.taskId); }); void job.done.catch(() => {});
  }
  private check(job: Job): void { if (job.controller.signal.aborted) throw new GameProcessError('CANCELLED'); }
  private change(job: Job, transform: (state: Execution) => Execution): Promise<void> {
    const operation = job.changes.then(async () => {
      const next = transform(job.task.execution); if (next === job.task.execution) return;
      job.task = await this.storage.update(job.task.ownerId, job.task.taskId, job.task.execution.revision, next);
    }); job.changes = operation.catch(() => {}); return operation;
  }
  private event(job: Job, kind: 'transferred' | 'verified' | 'committed' | 'failed' | 'cleaned'): Promise<void> {
    return this.change(job, state => applyWorkerEvent(state, { kind, attempt: state.attempt, sequence: state.lastSequence + 1 } as WorkerEvent).execution);
  }
  private observe(sessionId: string): void {
    const observer = this.processes.wait(sessionId).then(async snapshot => { await this.save(sessionId, current => ({ ...current!, spawned: true, snapshot })); });
    this.observers.add(observer); void observer.finally(() => { this.observers.delete(observer); if (!this.hasRunningGames()) this.idleListener?.(); }).catch(() => {});
  }
  /** Only sessions belonging to the registered root are visible; live process facts override an older persisted snapshot. */
  async session(rootId: string, sessionId: string): Promise<GameSession> {
    const record = this.records().find(item => item.rootId === rootId && item.taskId === sessionId); if (!record) throw new GameProcessError('SESSION_NOT_FOUND');
    return this.owned.has(sessionId) ? this.processes.get(sessionId) : { ...record.snapshot };
  }
  async sessions(rootId: string): Promise<GameSession[]> {
    return Promise.all(this.records().filter(item => item.rootId === rootId && (item.spawned || this.owned.has(item.taskId) || this.jobs.has(item.taskId))).map(item => this.session(rootId, item.taskId)));
  }
  /** Queries launch/stop only; install tasks remain with their original owner/service. */
  async task(rootId: string, taskId: string): Promise<GameTaskView | undefined> {
    const task = this.jobs.get(taskId)?.task ?? await this.storage.get(rootId, taskId);
    if (!task || task.ownerId !== rootId || !['launch', 'stop'].includes(task.kind)) return undefined;
    const session = this.records().find(item => item.rootId === rootId && (item.taskId === taskId || item.stopTaskIds.includes(taskId)));
    if (!session) throw new GameProcessError('NEEDS_RECOVERY'); return { task, session };
  }
  async tasks(rootId: string): Promise<GameTaskView[]> {
    const ids = this.records().filter(item => item.rootId === rootId).flatMap(item => [item.taskId, ...item.stopTaskIds]);
    const tasks: GameTaskView[] = []; for (const id of ids) { const task = await this.task(rootId, id); if (task) tasks.push(task); } return tasks;
  }
  /** Tests registry membership without querying install task rows or exposing another owner's sessions. */
  hasTask(rootId: string, taskId: string): boolean { return this.records().some(item => item.rootId === rootId && (item.taskId === taskId || item.stopTaskIds.includes(taskId))); }
  /** Main-process lifecycle callback; no renderer function crosses this boundary. */
  onIdle(listener: () => void): void { this.idleListener = listener; }
  /** Persist cancellation before interrupting pre-spawn verification. A committed/started process needs an explicit stop. */
  async cancel(rootId: string, taskId: string): Promise<void> {
    const job = this.jobs.get(taskId);
    if (!job || job.task.ownerId !== rootId) { const task = await this.storage.get(rootId, taskId); throw new LaunchServiceError(task?.execution.state === 'completed' ? 'CANCEL_TOO_LATE' : 'INVALID_TASK_STATE'); }
    await this.change(job, state => { const next = controlTask(state, 'cancel'); if (next.rejected) throw new LaunchServiceError(next.rejected); return next.execution; }); job.controller.abort();
  }
  hasRunningGames(): boolean { return [...this.owned].some(id => ['running', 'stopping'].includes(this.processes.get(id).state)); }
  /** False means a real game remains alive: the application must retain this process owner and storage. */
  async close(): Promise<boolean> {
    this.closed = true; await this.admissionTail;
    for (const job of this.jobs.values()) if (job.task.execution.state !== 'committing') await this.cancel(job.task.ownerId, job.task.taskId).catch(() => {});
    await Promise.allSettled([...this.jobs.values()].map(job => job.done));
    if (this.hasRunningGames()) { this.closed = false; return false; }
    await Promise.allSettled([...this.observers]); await this.indexTail; return true;
  }
}
