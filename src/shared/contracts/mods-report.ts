import { exactObject, UUID_PATTERN } from './handshake.js';
import { resourceId } from './resources.js';
import { validateComponent } from '../../core/path/layout.js';
import { installRelativePath } from '../../core/install/assets.js';
import type { ModFormat } from '../../core/mods/declarations.js';
import type { Compatibility } from '../../core/mods/ranges.js';

export interface ModReportIssue {
  scope: 'local' | 'platform'; severity: 'error' | 'unknown' | 'warning'; code: string; fileId: string;
  modId: string | null; targetModId: string | null; targetProjectId: string | null; targetVersionId: string | null;
  requirement: string | null; actual: string[]; via: string[];
}
export interface ModFileSummary {
  fileId: string; filename: string; enabled: boolean; size: number | null; sha1: string | null; sha256: string | null; sha512: string | null;
  mods: Array<{ format: ModFormat; id: string; version: string | null; name: string }>;
  sourceStatus: 'matched' | 'unknown' | 'conflict'; source: { projectId: string; versionId: string; versionName: string } | null;
  issues: string[];
}
export interface ModReport {
  formatVersion: 1; instanceId: string; instanceRevision: number; fingerprint: string; checkedAt: string; mode: 'list' | 'check';
  localState: Compatibility; state: Compatibility; files: ModFileSummary[]; issues: ModReportIssue[];
}
const states: readonly string[] = ['satisfied', 'unsatisfied', 'unknown'];
const code = (value: unknown): value is string => typeof value === 'string' && /^[A-Z_]{1,64}$/.test(value);
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\p{C}]/u.test(value);
const nullableText = (value: unknown, maximum: number): boolean => value === null || text(value, maximum);
const nullableHash = (value: unknown, length: number): boolean => value === null || typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const fileId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_-]{1,63}$/.test(value);
const nullableId = (value: unknown): boolean => value === null || id(value);
const nullableProject = (value: unknown): boolean => value === null || resourceId(value);
const member = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);

export function isModFileSummary(value: unknown): value is ModFileSummary {
  if (!exactObject(value, ['fileId', 'filename', 'enabled', 'size', 'sha1', 'sha256', 'sha512', 'mods', 'sourceStatus', 'source', 'issues'])
    || !fileId(value.fileId) || typeof value.filename !== 'string' || !/\.jar(?:\.disabled)?$/i.test(value.filename)
    || typeof value.enabled !== 'boolean' || value.enabled === value.filename.toLowerCase().endsWith('.disabled')
    || value.size !== null && (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0)
    || !nullableHash(value.sha1, 40) || !nullableHash(value.sha256, 64) || !nullableHash(value.sha512, 128)
    || !Array.isArray(value.mods) || value.mods.length > 256 || !Array.isArray(value.issues) || value.issues.length > 256 || !value.issues.every(code)
    || !member(value.sourceStatus, ['matched', 'unknown', 'conflict'])) return false;
  if ([value.sha1, value.sha256, value.sha512].some(hash => hash === null) && [value.sha1, value.sha256, value.sha512].some(hash => hash !== null)) return false;
  try { validateComponent(value.filename); } catch { return false; }
  if (value.source !== null && (!exactObject(value.source, ['projectId', 'versionId', 'versionName'])
    || !resourceId(value.source.projectId) || !resourceId(value.source.versionId) || !text(value.source.versionName, 256) || value.sha512 === null)) return false;
  if (value.sourceStatus === 'unknown' && value.source !== null || value.sourceStatus !== 'unknown' && value.source === null) return false;
  for (const mod of value.mods) if (!exactObject(mod, ['format', 'id', 'version', 'name'])
    || !member(mod.format, ['fabric', 'quilt', 'forge', 'neoforge']) || !id(mod.id) || !nullableText(mod.version, 160)
    || typeof mod.version === 'string' && mod.version.includes('${') || !text(mod.name, 256)) return false;
  return true;
}

export function isModReportIssue(value: unknown): value is ModReportIssue {
  if (!exactObject(value, ['scope', 'severity', 'code', 'fileId', 'modId', 'targetModId', 'targetProjectId', 'targetVersionId', 'requirement', 'actual', 'via'])
    || value.scope !== 'local' && value.scope !== 'platform' || !member(value.severity, ['error', 'unknown', 'warning'])
    || !code(value.code) || value.fileId !== '' && !fileId(value.fileId) || !nullableId(value.modId) || !nullableId(value.targetModId)
    || !nullableProject(value.targetProjectId) || !nullableProject(value.targetVersionId) || !nullableText(value.requirement, 8192)
    || !Array.isArray(value.actual) || value.actual.length > 16 || !value.actual.every(item => text(item, 160))
    || !Array.isArray(value.via) || value.via.length > 4) return false;
  for (const entry of value.via) {
    if (typeof entry !== 'string' || entry.length > 4096) return false;
    try { installRelativePath(entry); } catch { return false; }
  }
  return true;
}

/** Validates the complete bounded public/persisted report; no executable argument, absolute path or raw declaration body. */
export function isModReport(value: unknown): value is ModReport {
  if (!exactObject(value, ['formatVersion', 'instanceId', 'instanceRevision', 'fingerprint', 'checkedAt', 'mode', 'localState', 'state', 'files', 'issues'])
    || value.formatVersion !== 1 || typeof value.instanceId !== 'string' || !UUID_PATTERN.test(value.instanceId)
    || typeof value.instanceRevision !== 'number' || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1
    || !fileId(value.fingerprint) || typeof value.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.checkedAt)
    || !Number.isFinite(Date.parse(value.checkedAt)) || value.mode !== 'list' && value.mode !== 'check'
    || !member(value.localState, states) || !member(value.state, states)
    || !Array.isArray(value.files) || value.files.length > 256 || !value.files.every(isModFileSummary)
    || new Set(value.files.map(file => file.fileId)).size !== value.files.length
    || new Set(value.files.map(file => file.filename.toLowerCase())).size !== value.files.length
    || !Array.isArray(value.issues) || value.issues.length > 512 || !value.issues.every(isModReportIssue)) return false;
  const ids = new Set(value.files.map(file => file.fileId));
  if (value.issues.some(issue => issue.fileId !== '' && !ids.has(issue.fileId))) return false;
  if (value.state === 'satisfied' && (value.issues.some(issue => issue.severity !== 'warning') || value.localState !== 'satisfied')) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= 2 * 1024 ** 2; } catch { return false; }
}
