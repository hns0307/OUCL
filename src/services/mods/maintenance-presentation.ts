import type { MaintenanceFinding, MaintenanceRelation } from '../../core/mods/maintenance-impact.js';
import { validateComponent } from '../../core/path/layout.js';
import { resourceId } from '../../shared/contracts/resources.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import type { MaintenancePreview } from './maintenance-preview.js';

interface DisplayIssue {
  moment: 'before' | 'after'; scope: 'local' | 'platform'; severity: 'error' | 'unknown' | 'warning';
  code: string; fileId: string; modId: string | null; dependencyModId: string | null;
  dependencyProjectId: string | null; dependencyVersionId: string | null;
  requirement: string | null; actual: string[]; embeddedDepth: number;
}
interface DisplayRelation {
  scope: 'local' | 'platform'; dependentFileId: string; providerFileId: string; optional: boolean;
  dependencyModId: string | null; dependencyProjectId: string | null; dependencyVersionId: string | null; embeddedDepth: number;
}
interface DisplayProvider { id: string; ownerId: string; version: string | null; embeddedDepth: number }
export interface MaintenanceDisplay {
  rootId: string; instanceId: string; instanceRevision: number; fingerprint: string; fileId: string;
  filename: string; sha256: string | null; action: 'enable' | 'disable'; state: 'ready' | 'blocked' | 'unknown';
  providers: DisplayProvider[]; directRequiredBy: string[]; transitiveRequiredBy: string[];
  issues: DisplayIssue[]; relations: DisplayRelation[]; platformFailures: string[]; incomplete: boolean;
}
const LIMIT = 512;
const modId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_-]{1,63}$/.test(value);
const fileId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const code = (value: unknown): value is string => typeof value === 'string' && /^[A-Z_]{1,64}$/.test(value);
const safeText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
  && /^[A-Za-z0-9 .+_*,<>=!|()[\]{}":-]+$/.test(value);

/** Builds a bounded internal display model; it does not authorize a write or define an IPC contract.
 * Unsupported evidence is omitted and forces an unknown result instead of silently advertising readiness.
 */
export function presentMaintenancePreview(preview: MaintenancePreview): MaintenanceDisplay {
  const { impact } = preview; let incomplete = impact.truncated; let budget = LIMIT;
  const take = (): boolean => { if (budget === 0) { incomplete = true; return false; } budget--; return true; };
  const filename = preview.filename;
  try { validateComponent(filename); } catch { throw new Error('INVALID_MAINTENANCE_PRESENTATION'); }
  if (!/\.jar(?:\.disabled)?$/i.test(filename) || !fileId(impact.fileId) || !fileId(preview.fingerprint)
    || !UUID_PATTERN.test(preview.rootId) || !UUID_PATTERN.test(preview.instanceId)
    || !Number.isSafeInteger(preview.instanceRevision) || preview.instanceRevision < 1
    || preview.sha256 !== null && !fileId(preview.sha256)) throw new Error('INVALID_MAINTENANCE_PRESENTATION');
  const providers: DisplayProvider[] = [];
  for (const provider of impact.affectedProviders) {
    if (!take()) break;
    if (!modId(provider.id) || !modId(provider.ownerId) || provider.via.length > 4) { incomplete = true; continue; }
    const version = provider.version === null || safeText(provider.version, 160) ? provider.version : null;
    if (version === null && provider.version !== null) incomplete = true;
    providers.push({ id: provider.id, ownerId: provider.ownerId, version, embeddedDepth: provider.via.length });
  }
  const issues: DisplayIssue[] = [];
  const appendIssue = (finding: MaintenanceFinding, moment: DisplayIssue['moment']): void => {
    if (!take()) return;
    const issue = finding.issue;
    if (!code(issue.code) || issue.fileId !== '' && !fileId(issue.fileId)) { incomplete = true; return; }
    if (finding.scope === 'local' && 'dependencyId' in issue) {
      const requirement = issue.expected === null ? null : typeof issue.expected === 'string' ? issue.expected : JSON.stringify(issue.expected);
      const acceptedRequirement = requirement === null || safeText(requirement, 2048) ? requirement : null;
      const actual = issue.actual.filter(value => safeText(value, 160)).slice(0, 16);
      const validMod = issue.modId === null || modId(issue.modId); const validDependency = issue.dependencyId === null || modId(issue.dependencyId);
      if (!validMod || !validDependency || requirement !== acceptedRequirement || actual.length !== issue.actual.length || issue.via.length > 4) incomplete = true;
      issues.push({ moment, scope: 'local', severity: issue.severity, code: issue.code, fileId: issue.fileId,
        modId: validMod ? issue.modId : null, dependencyModId: validDependency ? issue.dependencyId : null,
        dependencyProjectId: null, dependencyVersionId: null, requirement: acceptedRequirement, actual, embeddedDepth: Math.min(issue.via.length, 4) });
    } else if (finding.scope === 'platform' && 'dependencyProjectId' in issue) {
      const project = issue.dependencyProjectId === null || resourceId(issue.dependencyProjectId) ? issue.dependencyProjectId : null;
      const version = issue.dependencyVersionId === null || resourceId(issue.dependencyVersionId) ? issue.dependencyVersionId : null;
      if (project !== issue.dependencyProjectId || version !== issue.dependencyVersionId) incomplete = true;
      issues.push({ moment, scope: 'platform', severity: issue.severity, code: issue.code, fileId: issue.fileId,
        modId: null, dependencyModId: null, dependencyProjectId: project, dependencyVersionId: version,
        requirement: null, actual: [], embeddedDepth: 0 });
    } else incomplete = true;
  };
  for (const issue of impact.before.local.issues) appendIssue({ scope: 'local', issue }, 'before');
  for (const issue of impact.before.platform.issues) appendIssue({ scope: 'platform', issue }, 'before');
  for (const issue of impact.after.local.issues) appendIssue({ scope: 'local', issue }, 'after');
  for (const issue of impact.after.platform.issues) appendIssue({ scope: 'platform', issue }, 'after');
  const relations: DisplayRelation[] = [];
  for (const relation of impact.relations) {
    if (!take()) break;
    if (!fileId(relation.dependentFileId) || !fileId(relation.providerFileId) || relation.via.length > 4) { incomplete = true; continue; }
    let dependencyModId: string | null = null; let dependencyProjectId: string | null = null; let dependencyVersionId: string | null = null;
    if (relation.scope === 'local') {
      if (!modId(relation.selector)) { incomplete = true; continue; } dependencyModId = relation.selector;
    } else {
      const parsed = parsePlatformSelector(relation); if (!parsed) { incomplete = true; continue; }
      dependencyProjectId = parsed.projectId; dependencyVersionId = parsed.versionId;
    }
    relations.push({ scope: relation.scope, dependentFileId: relation.dependentFileId, providerFileId: relation.providerFileId,
      optional: relation.optional, dependencyModId, dependencyProjectId, dependencyVersionId, embeddedDepth: relation.via.length });
  }
  const validIds = (values: string[]): string[] => {
    const result: string[] = [];
    for (const value of values) {
      if (!take()) break;
      if (result.length >= 256 || !fileId(value)) { incomplete = true; continue; }
      result.push(value);
    }
    return result;
  };
  const directRequiredBy = validIds(impact.directRequiredBy); const transitiveRequiredBy = validIds(impact.transitiveRequiredBy);
  const platformFailures: string[] = [];
  for (const failure of preview.platformFailures) {
    if (!take()) break;
    if (!code(failure)) { incomplete = true; continue; }
    platformFailures.push(failure);
  }
  return { rootId: preview.rootId, instanceId: preview.instanceId, instanceRevision: preview.instanceRevision, fingerprint: preview.fingerprint,
    fileId: impact.fileId, filename, sha256: preview.sha256, action: impact.action,
    state: impact.state === 'blocked' ? 'blocked' : incomplete || platformFailures.length ? 'unknown' : impact.state,
    providers, directRequiredBy, transitiveRequiredBy, issues, relations, platformFailures, incomplete };
}

function parsePlatformSelector(relation: MaintenanceRelation): { projectId: string | null; versionId: string | null } | undefined {
  try {
    const value: unknown = JSON.parse(relation.selector);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== 2 || !Object.hasOwn(item, 'projectId') || !Object.hasOwn(item, 'versionId')
      || item.projectId !== null && !resourceId(item.projectId) || item.versionId !== null && !resourceId(item.versionId)
      || item.projectId === null && item.versionId === null) return undefined;
    return { projectId: item.projectId as string | null, versionId: item.versionId as string | null };
  } catch { return undefined; }
}
