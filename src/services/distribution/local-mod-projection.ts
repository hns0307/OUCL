import { exactObject } from '../../shared/contracts/handshake.js';
import { installRelativePath } from '../../core/install/assets.js';
import type { LocalModArchive } from '../../core/mods/check.js';
import { plannedModFacts } from '../mods/facts.js';
import type { ModArchiveScan } from '../mods/archive.js';
import { modInventoryFingerprint } from '../mods/inventory.js';
import type { ModInventoryItem } from '../mods/inventory.js';
import { parseModArchiveReply } from '../workers/mod-archive-protocol.js';
import { parseModDeclarationFacts } from '../workers/mod-declarations-protocol.js';
import { parseDistributionPlan, transactionDigest } from './transaction-record.js';
import type { DistributionPlan } from './transaction-record.js';

export type ModProjectionCode = 'INVALID_INPUT' | 'UNSUPPORTED_OPERATION' | 'UNKNOWN_FACTS' | 'FACT_LIMIT'
  | 'NAME_CONFLICT' | 'OLD_HASH_MISMATCH' | 'ARTIFACT_MISMATCH' | 'SCAN_BINDING';
/** Pure projection failures carry no disk path, raw document or permission claim. */
export class ModProjectionError extends Error {
  constructor(readonly code: ModProjectionCode) { super(code); this.name = 'ModProjectionError'; }
}
export interface DistributionModProjectionInput {
  plan: DistributionPlan;
  baseline: readonly ModInventoryItem[];
  scans: readonly { operationIndex: number; scan: ModArchiveScan }[];
}
export interface DistributionModProjection { items: ModInventoryItem[]; fingerprint: string }
function fail(code: ModProjectionCode): never { throw new ModProjectionError(code); }
const hash = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
function budget(value: unknown): void {
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(value)); } catch { return fail('INVALID_INPUT'); }
  if (bytes > 8 * 1024 ** 2) fail('FACT_LIMIT');
}
function filename(value: unknown, disabled: boolean): value is string {
  if (typeof value !== 'string' || value.includes('/') || value.includes('\\')) return false;
  try { installRelativePath(value); } catch { return false; }
  return value.toLowerCase().endsWith(disabled ? '.jar.disabled' : '.jar');
}
function archives(value: unknown): value is LocalModArchive[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return false;
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!exactObject(item, ['entries', 'declarations', 'jarJar']) || typeof item.jarJar !== 'boolean'
      || !Array.isArray(item.entries) || item.entries.length > 4 || (index === 0) !== (item.entries.length === 0)
      || !Array.isArray(item.declarations) || item.declarations.length > 4) return false;
    for (const entry of item.entries) {
      if (typeof entry !== 'string' || !entry.endsWith('.jar')) return false;
      try { installRelativePath(entry); } catch { return false; }
    }
    const key = JSON.stringify(item.entries);
    if (seen.has(key) || index > 0 && !seen.has(JSON.stringify(item.entries.slice(0, -1)))) return false;
    seen.add(key); const formats = new Set<string>();
    for (const declaration of item.declarations) {
      try { const parsed = parseModDeclarationFacts(declaration); if (formats.has(parsed.format)) return false; formats.add(parsed.format); }
      catch { return false; }
    }
  }
  return true;
}
function baselineItem(item: unknown, instanceId: string): asserts item is ModInventoryItem {
  if (!exactObject(item, ['fileId', 'filename', 'enabled', 'size', 'sha1', 'sha256', 'sha512', 'archives', 'issues'])
    || typeof item.enabled !== 'boolean' || !filename(item.filename, !item.enabled)
    || item.fileId !== transactionDigest({ instanceId, filename: item.filename })
    || typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 64 * 1024 ** 2
    || !Array.isArray(item.issues) || item.issues.length > 2048 || !item.issues.every(issue => typeof issue === 'string' && /^[A-Z_]{1,64}$/.test(issue))
    || !archives(item.archives)) fail('INVALID_INPUT');
  if (item.sha1 === null || item.sha256 === null || item.sha512 === null) fail('UNKNOWN_FACTS');
  if (!hash(item.sha1, 40) || !hash(item.sha256, 64) || !hash(item.sha512, 128)) fail('INVALID_INPUT');
}

/** Builds the complete expected inventory without IO or authorization. Compatibility, source trust,
 * licences, ownership and receipt/lease gates remain separate; this result alone never permits execution.
 */
export function projectDistributionMods(input: DistributionModProjectionInput): DistributionModProjection {
  if (!exactObject(input, ['plan', 'baseline', 'scans']) || !Array.isArray(input.baseline) || !Array.isArray(input.scans)) fail('INVALID_INPUT');
  if (input.baseline.length > 256 || input.scans.length > 256) fail('FACT_LIMIT'); budget(input);
  let plan: DistributionPlan; try { plan = parseDistributionPlan(input.plan); } catch { return fail('INVALID_INPUT'); }
  for (const operation of plan.manifest.operations) if (operation.area !== 'mods' || !filename(operation.path, false)) fail('UNSUPPORTED_OPERATION');
  const files = new Map<string, ModInventoryItem>();
  for (const item of input.baseline) {
    baselineItem(item, plan.instanceId); const key = item.filename.toLowerCase();
    if (files.has(key)) fail('NAME_CONFLICT'); files.set(key, item);
  }
  const scans = new Map<number, ModArchiveScan>();
  for (const binding of input.scans) {
    if (!exactObject(binding, ['operationIndex', 'scan']) || typeof binding.operationIndex !== 'number' || !Number.isSafeInteger(binding.operationIndex)
      || binding.operationIndex < 0 || scans.has(binding.operationIndex)) fail('SCAN_BINDING');
    const operation = plan.manifest.operations[binding.operationIndex];
    if (!operation || operation.kind !== 'add' && operation.kind !== 'replace') fail('SCAN_BINDING');
    let parsed;
    try { parsed = parseModArchiveReply({ version: 1, kind: 'mod-archive-result', result: binding.scan }); } catch { return fail('INVALID_INPUT'); }
    if (parsed.kind !== 'mod-archive-result') fail('INVALID_INPUT');
    if (parsed.result.sha256 !== operation.sha256 || parsed.result.size !== operation.size) fail('ARTIFACT_MISMATCH');
    scans.set(binding.operationIndex, parsed.result);
  }
  for (const [index, operation] of plan.manifest.operations.entries()) {
    if (operation.kind === 'keep') continue;
    const key = operation.path.toLowerCase(); const old = files.get(key);
    if (operation.kind === 'add') { if (old) fail('NAME_CONFLICT'); }
    else {
      if (!old || old.sha256 !== operation.expectedSha256) fail('OLD_HASH_MISMATCH');
      files.delete(key);
    }
    if (operation.kind !== 'remove') {
      const scan = scans.get(index); if (!scan) fail('SCAN_BINDING');
      files.set(key, plannedModFacts(plan.instanceId, operation.path, scan));
    }
  }
  if (files.size > 256) fail('FACT_LIMIT');
  const items = structuredClone([...files.values()]); budget(items);
  return { items, fingerprint: modInventoryFingerprint(plan.instanceId, plan.instanceRevision, items) };
}
