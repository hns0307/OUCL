import { isModReport } from '../../shared/contracts/mods-report.js';
import type { ModReport, ModReportIssue } from '../../shared/contracts/mods-report.js';
import type { ModInventory } from './inventory.js';
import { ModInventoryError } from './inventory.js';
import type { ModInspection } from './inspection.js';

const safeId = (id: string | null): string | null => id && /^[a-z][a-z0-9_-]{1,63}$/.test(id) ? id : null;

/** Reduces private declaration/source facts into one bounded, path-free report suitable for IPC and atomic persistence. */
export function publicModReport(inventory: ModInventory, inspection?: ModInspection, checkedAt = new Date().toISOString()): ModReport {
  const issues: ModReportIssue[] = inventory.local.issues.map(issue => ({ scope: 'local', severity: issue.severity, code: issue.code,
    fileId: issue.fileId, modId: safeId(issue.modId), targetModId: safeId(issue.dependencyId), targetProjectId: null, targetVersionId: null,
    requirement: issue.expected === null ? null : typeof issue.expected === 'string' ? issue.expected : JSON.stringify(issue.expected), actual: issue.actual, via: issue.via }));
  for (const issue of inspection?.platform.issues ?? []) issues.push({ scope: 'platform', severity: issue.severity, code: issue.code,
    fileId: issue.fileId, modId: null, targetModId: null, targetProjectId: issue.dependencyProjectId, targetVersionId: issue.dependencyVersionId,
    requirement: null, actual: [], via: [] });
  for (const failure of inspection?.platformFailures ?? []) issues.push({ scope: 'platform', severity: 'unknown', code: failure,
    fileId: '', modId: null, targetModId: null, targetProjectId: null, targetVersionId: null, requirement: null, actual: [], via: [] });
  if (issues.length > 512) issues.splice(511, issues.length - 511, { scope: 'local', severity: 'unknown', code: 'REPORT_LIMIT', fileId: '',
    modId: null, targetModId: null, targetProjectId: null, targetVersionId: null, requirement: null, actual: [], via: [] });
  const files = inventory.items.map(item => {
    const association = inspection?.platform.files.find(file => file.fileId === item.fileId);
    const mods = (item.archives.find(archive => !archive.entries.length)?.declarations ?? []).flatMap(facts => facts.mods.map(mod => ({
      format: facts.format, id: mod.id, version: mod.version, name: mod.name })));
    if (mods.length > 256) throw new ModInventoryError('MOD_LIMIT');
    return { fileId: item.fileId, filename: item.filename, enabled: item.enabled, size: item.size, sha1: item.sha1, sha256: item.sha256, sha512: item.sha512,
      mods, issues: item.issues, sourceStatus: association?.status ?? 'unknown' as const,
      source: association?.version ? { projectId: association.version.projectId, versionId: association.version.versionId, versionName: association.version.name } : null };
  });
  const result: ModReport = { formatVersion: 1, instanceId: inventory.instanceId, instanceRevision: inventory.revision, fingerprint: inventory.fingerprint,
    checkedAt, mode: inspection ? 'check' : 'list', localState: inventory.local.state, state: inspection?.platform.state ?? inventory.local.state, files, issues };
  if (!isModReport(result)) throw new ModInventoryError('MOD_LIMIT'); return result;
}
