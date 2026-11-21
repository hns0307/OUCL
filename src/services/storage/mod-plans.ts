import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isModInstallPlan, isModPayload } from '../../shared/contracts/mods.js';
import type { ModInstallPlan, ModPayloads } from '../../shared/contracts/mods.js';
import { canonicalModPlanInput, modPlanDigest, modPlanInputDigest } from '../mods/plan-identity.js';
import { StorageError } from './files.js';

export interface StoredModPlan {
  formatVersion: 1; rootId: string; requestId: string; payloadDigest: string;
  input: ModPayloads['mods:plan']; plan: ModInstallPlan; status: 'preview' | 'cancelled';
}
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
function invalid(): never { throw new StorageError('INVALID_RECORD'); }
/** One fixed, bounded domain per request. Renderer identifiers can never select arbitrary files. */
export function modPlanRecordId(requestId: string): string {
  if (!uuid(requestId)) invalid(); return `mod-plan-${requestId.toLowerCase()}`;
}
/** Revalidates both local content identities and the exact request/target association on every read. */
export function parseStoredModPlan(value: unknown): StoredModPlan {
  if (!exactObject(value, ['formatVersion', 'rootId', 'requestId', 'payloadDigest', 'input', 'plan', 'status'])
    || value.formatVersion !== 1 || !uuid(value.rootId) || !uuid(value.requestId)
    || typeof value.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.payloadDigest)
    || !isModPayload(value.input, 'mods:plan') || !isModInstallPlan(value.plan)
    || value.status !== 'preview' && value.status !== 'cancelled') invalid();
  const input = canonicalModPlanInput(value.input); const plan = value.plan;
  if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 ** 2 || value.payloadDigest !== modPlanInputDigest(input)
    || plan.planId !== modPlanDigest(plan) || plan.instanceId !== input.instanceId || plan.instanceRevision !== input.expectedRevision
    || plan.rootVersionId !== input.root.versionId
    || plan.totalDownloadBytes !== plan.items.filter(item => item.disposition === 'download').reduce((sum, item) => sum + item.size, 0)
    || new Set(plan.items.map(item => item.projectId)).size !== plan.items.length
    || plan.state === 'ready' && (plan.issues.length > 0 || plan.items.filter(item => item.versionId === input.root.versionId
      && item.projectId === input.root.projectId && item.fileId === input.root.fileId).length !== 1)) invalid();
  return { formatVersion: 1, rootId: value.rootId.toLowerCase(), requestId: value.requestId.toLowerCase(),
    payloadDigest: value.payloadDigest, input, plan: structuredClone(plan), status: value.status };
}
/** Stored evidence is immutable. The only supported transition is preview to cancelled. */
export function assertModPlanTransition(previous: StoredModPlan | undefined, next: StoredModPlan): void {
  if (!previous) { if (next.status !== 'preview') invalid(); return; }
  if (JSON.stringify({ ...previous, status: 'preview' }) !== JSON.stringify({ ...next, status: 'preview' })
    || previous.status === 'cancelled' && next.status !== 'cancelled') invalid();
}
