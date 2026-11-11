import { randomUUID } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { instanceFailure } from '../shared/contracts/instances.js';
import { isTargetRequest, isTargetResult, targetFilter } from '../shared/contracts/task-targets.js';
import type { TargetCode, TargetQuery, TargetRequest, TargetResult, TargetRow } from '../shared/contracts/task-targets.js';
import type { StorageClient } from '../services/workers/storage-client.js';
import { WorkerError } from '../services/workers/protocol.js';
import type { ModTaskService } from '../services/mods/tasks.js';
import type { ModInstallTaskService } from '../services/mods/install-tasks.js';

interface Snapshot { id: string; sender: number; generation: number; rootId: string; rootRevision: number; filter: string; rows: TargetRow[] }
interface Cursor { snapshotId: string; sender: number; offset: number; expires: number }
function failure(requestId: string, code: TargetCode, traceId: string): TargetResult {
  const result = instanceFailure(requestId, code, traceId);
  if (result.ok) throw new Error('UNREACHABLE');
  return { ...result, error: { ...result.error, code } };
}
function workerCode(error: unknown): TargetCode {
  if (!(error instanceof WorkerError)) return 'UNAVAILABLE';
  if (error.code === 'TARGET_ROOT_CHANGED') return 'ROOT_UNAVAILABLE';
  if (error.code === 'TARGET_OUT_OF_SCOPE') return 'OUT_OF_SCOPE';
  if (error.code === 'TIMEOUT') return 'TIMEOUT';
  if (['INVALID_RECORD', 'NEEDS_RECOVERY', 'REVISION_CONFLICT'].includes(error.code)) return 'NEEDS_RECOVERY';
  return 'TASK_STORE_UNAVAILABLE';
}

/** Per-window, bounded snapshots of proven task ownership; observations never mutate tasks. */
export class TargetAdapter {
  private readonly generations = new Map<number, number>();
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly cursors = new Map<string, Cursor>();
  private readonly pending = new Set<number>();
  private closed = false;
  constructor(private readonly storage: StorageClient, private readonly checks: ModTaskService, private readonly installs: ModInstallTaskService) {}
  private generation(sender: number): number { return this.generations.get(sender) ?? 0; }
  private valid(sender: number, generation: number): boolean { return !this.closed && this.generation(sender) === generation; }
  private drop(id: string): void {
    this.snapshots.delete(id); for (const [key, cursor] of this.cursors) if (cursor.snapshotId === id) this.cursors.delete(key);
  }
  /** Invalidates observation resources on navigation or destruction without cancelling work. */
  removeSender(sender: number): void {
    this.generations.set(sender, this.generation(sender) + 1);
    for (const [id, snapshot] of this.snapshots) if (snapshot.sender === sender) this.drop(id);
  }
  /** Releases all observation resources during application shutdown. */
  close(): void { this.closed = true; this.snapshots.clear(); this.cursors.clear(); }
  private page(snapshot: Snapshot, offset: number, limit: number): { items: TargetRow[]; nextCursor?: string } {
    const items = snapshot.rows.slice(offset, offset + limit); const next = offset + items.length;
    if (next >= snapshot.rows.length) return { items };
    while (this.cursors.size >= 256) this.cursors.delete(this.cursors.keys().next().value!);
    const cursor = randomUUID(); this.cursors.set(cursor, { snapshotId: snapshot.id, sender: snapshot.sender, offset: next, expires: Date.now() + 30000 });
    return { items, nextCursor: cursor };
  }
  private async root(): Promise<{ rootId: string; rootRevision: number }> {
    const root = await this.storage.readInstallation(); if (!root) throw new WorkerError('TARGET_ROOT_CHANGED');
    return { rootId: root.data.rootId.toLowerCase(), rootRevision: root.revision };
  }
  private async read(query: TargetQuery): Promise<{ rootId: string; rootRevision: number; rows: TargetRow[] }> {
    const root = await this.root();
    const read = () => this.storage.readModTargets({ ...root, instanceId: query.instanceId, kinds: query.kinds });
    const targets = query.kinds.includes('mod-check') ? await this.checks.withTargetRead(read) : await read();
    const rows = targets.items.map(item => ({ instanceId: item.instanceId, instanceRevision: item.instanceRevision,
      task: (item.task.kind === 'mod-check' ? this.checks.targetTaskView(root.rootId, item.task) : this.installs.targetTaskView(root.rootId, item.task)).snapshot }));
    rows.sort((a, b) => a.task.kind < b.task.kind ? -1 : a.task.kind > b.task.kind ? 1 : a.task.taskId < b.task.taskId ? -1 : a.task.taskId > b.task.taskId ? 1 : 0);
    if (rows.length > 2000 || Buffer.byteLength(JSON.stringify({ items: rows, nextCursor: '00000000-0000-4000-8000-000000000000' })) > 1024 * 1024)
      throw new WorkerError('FILE_TOO_LARGE');
    const current = await this.root(); if (current.rootId !== root.rootId || current.rootRevision !== root.rootRevision) throw new WorkerError('TARGET_ROOT_CHANGED');
    return { ...root, rows };
  }
  /** Validates sender, request and response at the public IPC boundary. */
  async handle(input: unknown, trusted: boolean, sender: number, traceId: string): Promise<TargetResult> {
    const id = exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
    if (!trusted || this.closed) return failure(id, 'INVALID_SENDER', traceId);
    if (exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.contractVersion === 'number' && input.contractVersion > 1
      && isTargetRequest({ ...input, contractVersion: 1 })) return failure(id, 'UNSUPPORTED_CONTRACT', traceId);
    if (!isTargetRequest(input)) return failure(id, 'INVALID_ARGUMENT', traceId);
    const request: TargetRequest = input; const generation = this.generation(sender); const query = request.payload;
    try {
      let data: { items: TargetRow[]; nextCursor?: string };
      if (query.cursor) {
        const cursor = this.cursors.get(query.cursor);
        if (cursor && cursor.sender !== sender) return failure(id, 'OUT_OF_SCOPE', traceId);
        const snapshot = cursor && this.snapshots.get(cursor.snapshotId);
        if (!cursor || !snapshot || cursor.expires <= Date.now() || snapshot.generation !== generation || snapshot.filter !== targetFilter(query)) return failure(id, 'CURSOR_EXPIRED', traceId);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new WorkerError('TIMEOUT')); }, 2500); });
        let root: Awaited<ReturnType<TargetAdapter['root']>> | undefined;
        try { root = await Promise.race([this.root().catch(() => undefined), deadline]); } finally { clearTimeout(timer); }
        if (!this.valid(sender, generation)) return failure(id, 'INVALID_SENDER', traceId);
        if (cursor.expires <= Date.now() || this.cursors.get(query.cursor) !== cursor || this.snapshots.get(snapshot.id) !== snapshot)
          return failure(id, 'CURSOR_EXPIRED', traceId);
        if (!root || root.rootId !== snapshot.rootId || root.rootRevision !== snapshot.rootRevision) { this.drop(snapshot.id); return failure(id, 'CURSOR_EXPIRED', traceId); }
        data = this.page(snapshot, cursor.offset, query.limit);
      } else {
        if (this.pending.has(sender) || this.pending.size >= 2) return failure(id, 'UNAVAILABLE', traceId);
        this.pending.add(sender);
        const operation = this.read(query).finally(() => { this.pending.delete(sender); });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new WorkerError('TIMEOUT')); }, 2500); });
        let result: Awaited<ReturnType<TargetAdapter['read']>>;
        try { result = await Promise.race([operation, timeout]); } finally { clearTimeout(timer); }
        if (!this.valid(sender, generation)) return failure(id, 'INVALID_SENDER', traceId);
        while ([...this.snapshots.values()].filter(item => item.sender === sender).length >= 4) this.drop([...this.snapshots.values()].find(item => item.sender === sender)!.id);
        while (this.snapshots.size >= 16) this.drop(this.snapshots.keys().next().value!);
        const snapshot: Snapshot = { id: randomUUID(), sender, generation, ...result, filter: targetFilter(query) };
        this.snapshots.set(snapshot.id, snapshot); data = this.page(snapshot, 0, query.limit);
      }
      const result: TargetResult = { contractVersion: 1, requestId: id, ok: true, data };
      return isTargetResult(result, request) ? result : failure(id, 'UNAVAILABLE', traceId);
    } catch (error) { return failure(id, workerCode(error), traceId); }
  }
}
