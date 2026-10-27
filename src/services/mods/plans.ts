import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isModPayload, ModContractError } from '../../shared/contracts/mods.js';
import type { ModInstallPlan, ModPayloads, SavedModPlan } from '../../shared/contracts/mods.js';
import type { RecordEnvelope } from '../storage/records.js';
import type { StoredModPlan } from '../storage/mod-plans.js';
import { parseStoredModPlan } from '../storage/mod-plans.js';
import type { StorageClient } from '../workers/storage-client.js';
import { WorkerError } from '../workers/protocol.js';
import type { ModInstallPlanner } from './planner.js';
import { canonicalModPlanInput, modPlanInputDigest } from './plan-identity.js';

type Repository = Pick<StorageClient, 'readInstallation' | 'readModPlan' | 'writeModPlan'>;
interface Active { requestId: string; digest: string; done: Promise<ModInstallPlan>; controller: AbortController }
/** Persists previews and refusal only. A saved preview never authorizes downloads or instance writes. */
export class ModPlanService {
  private active: Active | undefined;
  private readonly operations = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly storage: Repository, private readonly planner: Pick<ModInstallPlanner, 'plan'>) {}
  private async root() {
    const root = await this.storage.readInstallation(); if (!root) throw new ModContractError('ROOT_UNAVAILABLE'); return root.data;
  }
  private validateId(requestId: string): string {
    if (!UUID_PATTERN.test(requestId)) throw new ModContractError('INVALID_ARGUMENT'); return requestId.toLowerCase();
  }
  private async record(requestId: string): Promise<RecordEnvelope<StoredModPlan> | undefined> {
    const root = await this.root(); const record = await this.storage.readModPlan(requestId);
    if (record && (record.data.rootId !== root.rootId || record.data.requestId !== requestId)) throw new ModContractError('NEEDS_RECOVERY');
    return record;
  }
  /** Equal in-flight requests join; other requests fail quickly instead of creating an unbounded queue. */
  create(requestId: string, input: ModPayloads['mods:plan']): Promise<ModInstallPlan> {
    if (this.closed) return Promise.reject(new ModContractError('UNAVAILABLE'));
    if (!isModPayload(input, 'mods:plan') || !UUID_PATTERN.test(requestId)) return Promise.reject(new ModContractError('INVALID_ARGUMENT'));
    const id = requestId.toLowerCase(); const selected = canonicalModPlanInput(input); const digest = modPlanInputDigest(selected);
    if (this.active) {
      if (this.active.requestId !== id) return Promise.reject(new ModContractError('SCAN_BUSY'));
      if (this.active.digest !== digest) return Promise.reject(new ModContractError('REVISION_CONFLICT'));
      return this.active.done.then(plan => structuredClone(plan));
    }
    const controller = new AbortController();
    const done = this.perform(id, selected, digest, controller.signal);
    const active = { requestId: id, digest, done, controller }; this.active = active;
    void done.finally(() => { if (this.active === active) this.active = undefined; }).catch(() => {});
    return done.then(plan => structuredClone(plan));
  }
  private async perform(requestId: string, input: ModPayloads['mods:plan'], digest: string, signal: AbortSignal): Promise<ModInstallPlan> {
    const previous = await this.record(requestId);
    if (previous) {
      if (previous.data.payloadDigest !== digest) throw new ModContractError('REVISION_CONFLICT');
      if (previous.data.status === 'cancelled') throw new ModContractError('CANCELLED');
      return structuredClone(previous.data.plan);
    }
    if (signal.aborted) throw new ModContractError('CANCELLED');
    const root = await this.root(); const plan = await this.planner.plan(structuredClone(input), signal);
    if (signal.aborted) throw new ModContractError('CANCELLED');
    if (JSON.stringify(await this.root()) !== JSON.stringify(root)) throw new ModContractError('FILES_CHANGED');
    const data = parseStoredModPlan({ formatVersion: 1, rootId: root.rootId, requestId, payloadDigest: digest, input, plan, status: 'preview' });
    const saved = await this.persist(0, data); return structuredClone(saved.data.plan);
  }
  private async persist(revision: number, data: StoredModPlan): Promise<RecordEnvelope<StoredModPlan>> {
    try { return await this.storage.writeModPlan(data.requestId, revision, data); }
    catch (error) {
      if (error instanceof WorkerError && ['TIMEOUT', 'REVISION_CONFLICT'].includes(error.code)) {
        // An acknowledgement can be lost after JSON publication. Only exact durable evidence can finish this operation.
        const saved = await this.record(data.requestId);
        if (saved && JSON.stringify(saved.data) === JSON.stringify(data)) return saved;
      }
      throw new ModContractError('NEEDS_RECOVERY');
    }
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation); void operation.finally(() => { this.operations.delete(operation); }).catch(() => {}); return operation;
  }
  get(requestId: string): Promise<SavedModPlan> {
    if (this.closed) return Promise.reject(new ModContractError('UNAVAILABLE'));
    return this.track(this.readSaved(requestId));
  }
  private async readSaved(requestId: string): Promise<SavedModPlan> {
    const record = await this.record(this.validateId(requestId)); if (!record) throw new ModContractError('NOT_FOUND');
    return { plan: structuredClone(record.data.plan), status: record.data.status };
  }
  /** Refusal is durable and idempotent. It changes no game or resource-library files. */
  cancel(requestId: string, planId: string): Promise<SavedModPlan> {
    if (this.closed) return Promise.reject(new ModContractError('UNAVAILABLE'));
    return this.track(this.performCancel(requestId, planId));
  }
  private async performCancel(requestId: string, planId: string): Promise<SavedModPlan> {
    const id = this.validateId(requestId);
    if (!/^[a-f0-9]{64}$/.test(planId)) throw new ModContractError('INVALID_ARGUMENT');
    const record = await this.record(id); if (!record) throw new ModContractError('NOT_FOUND');
    if (record.data.plan.planId !== planId) throw new ModContractError('REVISION_CONFLICT');
    const saved = record.data.status === 'cancelled' ? record : await this.persist(record.revision, { ...record.data, status: 'cancelled' });
    return { plan: structuredClone(saved.data.plan), status: saved.data.status };
  }
  async close(): Promise<void> {
    this.closed = true; const active = this.active; active?.controller.abort(); await active?.done.catch(() => {});
    await Promise.allSettled([...this.operations]);
  }
}
