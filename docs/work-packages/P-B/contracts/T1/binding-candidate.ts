// Pure research fixture: checks existing durable identity shapes, with no product registration/IO.
import { createHash } from 'node:crypto';
import { UUID_PATTERN } from '../../../../../src/shared/contracts/handshake.js';
import { isTaskSnapshot } from '../../../../../src/shared/contracts/instances.js';
import type { TaskSnapshot } from '../../../../../src/shared/contracts/instances.js';
import { parseExecution } from '../../../../../src/services/storage/tasks.js';
import type { StoredTask } from '../../../../../src/services/storage/tasks.js';
import { parseModJobs } from '../../../../../src/services/storage/mod-jobs.js';
import { parseStoredModPlan } from '../../../../../src/services/storage/mod-plans.js';
import { modConfirmationDigest } from '../../../../../src/services/mods/plan-identity.js';
import type { TargetKind, TargetRow } from './contract-candidate.js';
export interface Admission { requestId: string; payloadDigest: string; task: StoredTask }
export interface BindingInput {
  rootId: string; instanceId: string; kinds: TargetKind[]; admissions: Admission[];
  jobs: unknown; plans: Record<string, unknown>; snapshots: Record<string, TaskSnapshot>;
}
const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
export class CandidateRecoveryError extends Error { readonly code = 'NEEDS_RECOVERY'; }
function requireProof(value: unknown): asserts value { if (!value) throw new CandidateRecoveryError('Unproven identity'); }
export function projectCandidate(input: BindingInput): TargetRow[] {
  try {
    requireProof(UUID_PATTERN.test(input.rootId) && UUID_PATTERN.test(input.instanceId));
    requireProof(input.admissions.length <= 2000 && input.kinds.length >= 1 && input.kinds.length <= 2);
    const jobs = !input.kinds.includes('mod-check') || input.jobs === undefined ? undefined : parseModJobs(input.jobs);
    if (jobs) requireProof(same(jobs.rootId, input.rootId));
    const tasks = new Set<string>(), requests = new Set<string>(), counts = new Map<string, number>();
    const matched = new Set<string>(); const result: TargetRow[] = [];
    for (const accepted of input.admissions) {
      const task = accepted.task; parseExecution(task.execution);
      requireProof(UUID_PATTERN.test(task.taskId) && UUID_PATTERN.test(accepted.requestId) && same(task.ownerId, input.rootId));
      requireProof(task.kind === 'mod-check' || task.kind === 'mod-install');
      if (!input.kinds.includes(task.kind)) continue;
      requireProof(!tasks.has(task.taskId.toLowerCase()) && !requests.has(accepted.requestId.toLowerCase()));
      tasks.add(task.taskId.toLowerCase()); requests.add(accepted.requestId.toLowerCase());
      const count = (counts.get(task.kind) ?? 0) + 1; counts.set(task.kind, count); requireProof(count <= 1000);
      let instanceId: string, instanceRevision: number;
      if (task.kind === 'mod-check') {
        const job = jobs?.items.find(item => same(item.taskId, task.taskId)); requireProof(job);
        requireProof(same(job.requestId, accepted.requestId));
        const digest = createHash('sha256').update(JSON.stringify({ instanceId: job.instanceId.toLowerCase(), expectedRevision: job.instanceRevision, mode: job.mode })).digest('hex');
        requireProof(job.payloadDigest === digest && accepted.payloadDigest === digest);
        matched.add(job.taskId.toLowerCase()); instanceId = job.instanceId; instanceRevision = job.instanceRevision;
      } else {
        const raw = input.plans[accepted.requestId.toLowerCase()]; requireProof(raw);
        const plan = parseStoredModPlan(raw);
        requireProof(same(plan.rootId, input.rootId) && same(plan.requestId, accepted.requestId));
        requireProof(plan.status === 'preview' && plan.plan.state === 'ready');
        requireProof(accepted.payloadDigest === modConfirmationDigest(plan.requestId, plan.plan.planId));
        instanceId = plan.plan.instanceId; instanceRevision = plan.plan.instanceRevision;
      }
      if (!same(instanceId, input.instanceId)) continue;
      const snapshot = input.snapshots[task.taskId.toLowerCase()];
      requireProof(snapshot && isTaskSnapshot(snapshot) && same(snapshot.taskId, task.taskId) && snapshot.kind === task.kind
        && snapshot.revision >= task.execution.revision);
      result.push({ instanceId: instanceId.toLowerCase(), instanceRevision, task: { ...snapshot, taskId: snapshot.taskId.toLowerCase() } });
    }
    if (jobs && input.kinds.includes('mod-check')) requireProof(jobs.items.every(job => matched.has(job.taskId.toLowerCase())));
    return result.sort((left, right) => left.task.kind < right.task.kind ? -1 : left.task.kind > right.task.kind ? 1
      : left.task.taskId < right.task.taskId ? -1 : left.task.taskId > right.task.taskId ? 1 : 0);
  } catch (error) { if (error instanceof CandidateRecoveryError) throw error; throw new CandidateRecoveryError('Unproven durable record'); }
}
