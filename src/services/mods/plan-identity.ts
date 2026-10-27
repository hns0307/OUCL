import { createHash } from 'node:crypto';
import type { ModInstallPlan, ModPayloads } from '../../shared/contracts/mods.js';

/** Stable request identity, independent of renderer object-key order and UUID casing. */
export function canonicalModPlanInput(input: ModPayloads['mods:plan']): ModPayloads['mods:plan'] {
  return { instanceId: input.instanceId.toLowerCase(), expectedRevision: input.expectedRevision,
    root: { projectId: input.root.projectId, versionId: input.root.versionId, fileId: input.root.fileId },
    selections: Object.fromEntries(Object.entries(input.selections).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) };
}
export function modPlanInputDigest(input: ModPayloads['mods:plan']): string {
  return createHash('sha256').update(JSON.stringify(canonicalModPlanInput(input))).digest('hex');
}
/** Local content identity only; this digest is never presented as upstream authentication. */
export function modPlanDigest(plan: Omit<ModInstallPlan, 'planId'>): string {
  const body = { formatVersion: plan.formatVersion, instanceId: plan.instanceId, instanceRevision: plan.instanceRevision,
    fingerprint: plan.fingerprint, minecraft: plan.minecraft, loader: plan.loader, rootVersionId: plan.rootVersionId,
    state: plan.state, attempts: plan.attempts, totalDownloadBytes: plan.totalDownloadBytes,
    items: plan.items.map(item => ({ projectId: item.projectId, versionId: item.versionId, filename: item.filename,
      fileId: item.fileId, sha512: item.sha512, size: item.size, disposition: item.disposition, requiredBy: item.requiredBy })),
    issues: plan.issues.map(issue => ({ severity: issue.severity, code: issue.code, projectId: issue.projectId,
      versionId: issue.versionId, requiredBy: issue.requiredBy })) };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
