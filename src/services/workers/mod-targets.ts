import { createHash } from 'node:crypto';
import type { TargetKind } from '../../shared/contracts/task-targets.js';
import type { StoredTask } from '../storage/tasks.js';
import type { RecordStore } from '../storage/records.js';
import { parseInstallation } from '../storage/installation.js';
import { instanceRecordId, parseInstanceRecord } from '../storage/instance-records.js';
import { parseModJobs } from '../storage/mod-jobs.js';
import { modPlanRecordId, parseStoredModPlan } from '../storage/mod-plans.js';
import { modConfirmationDigest } from '../mods/plan-identity.js';
import { WorkerError } from './protocol.js';

export interface ModTargetsInput { rootId: string; rootRevision: number; instanceId: string; kinds: TargetKind[] }
export interface ModTargets { rootId: string; rootRevision: number; items: Array<{ instanceId: string; instanceRevision: number; task: StoredTask }> }

/** Proves all requested-domain admissions before returning the selected instance's immutable targets. */
export async function readModTargets(store: RecordStore, input: ModTargetsInput): Promise<ModTargets> {
  const deadline = Date.now() + 2000;
  const checkBudget = (): void => { if (Date.now() > deadline) throw new WorkerError('TIMEOUT'); };
  const rootId = input.rootId.toLowerCase(); const instanceId = input.instanceId.toLowerCase();
  const root = await store.read('installation', parseInstallation); checkBudget();
  if (!root || root.data.rootId.toLowerCase() !== rootId || root.revision !== input.rootRevision) throw new WorkerError('TARGET_ROOT_CHANGED');
  const instance = await store.read(instanceRecordId(instanceId), parseInstanceRecord); checkBudget();
  if (!instance || instance.data.summary.instanceId !== instanceId || instance.data.summary.rootId.toLowerCase() !== rootId
    || instance.data.summary.revision !== instance.revision) throw new WorkerError('TARGET_OUT_OF_SCOPE');
  const admissions = await store.readModTargetAdmissions(root.data.rootId, input.kinds); checkBudget();
  const items: ModTargets['items'] = [];
  if (input.kinds.includes('mod-check')) {
    const index = await store.read('mod-jobs', parseModJobs); checkBudget();
    if (index && index.data.rootId.toLowerCase() !== rootId) throw new WorkerError('NEEDS_RECOVERY');
    const jobs = index?.data.items ?? [];
    const accepted = admissions.filter(item => item.task.kind === 'mod-check');
    if (jobs.length !== accepted.length) throw new WorkerError('NEEDS_RECOVERY');
    const byTask = new Map(jobs.map(job => [job.taskId.toLowerCase(), job]));
    for (const row of accepted) {
      checkBudget(); const job = byTask.get(row.task.taskId.toLowerCase());
      if (!job || job.requestId.toLowerCase() !== row.requestId.toLowerCase() || job.payloadDigest !== row.payloadDigest
        || createHash('sha256').update(JSON.stringify({ instanceId: job.instanceId.toLowerCase(), expectedRevision: job.instanceRevision, mode: job.mode })).digest('hex') !== row.payloadDigest)
        throw new WorkerError('NEEDS_RECOVERY');
      if (job.instanceId.toLowerCase() === instanceId) items.push({ instanceId, instanceRevision: job.instanceRevision, task: row.task });
    }
  }
  if (input.kinds.includes('mod-install')) {
    for (const row of admissions.filter(item => item.task.kind === 'mod-install')) {
      checkBudget(); const requestId = row.requestId.toLowerCase();
      const plan = await store.read(modPlanRecordId(requestId), parseStoredModPlan); checkBudget();
      if (!plan || plan.data.rootId !== rootId || plan.data.requestId !== requestId || plan.data.status !== 'preview'
        || plan.data.plan.state !== 'ready' || row.payloadDigest !== modConfirmationDigest(requestId, plan.data.plan.planId)) throw new WorkerError('NEEDS_RECOVERY');
      if (plan.data.plan.instanceId.toLowerCase() === instanceId) items.push({ instanceId, instanceRevision: plan.data.plan.instanceRevision, task: row.task });
    }
  }
  const result = { rootId, rootRevision: input.rootRevision, items };
  if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new WorkerError('FILE_TOO_LARGE');
  checkBudget(); return result;
}
