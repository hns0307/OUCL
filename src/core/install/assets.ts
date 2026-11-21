import { validateComponent } from '../path/layout.js';
import { record } from '../version/validation.js';

export type InstallPlanCode = 'INVALID_ASSET_INDEX' | 'INVALID_INSTALL_PATH' | 'ASSET_INDEX_REQUIRED'
  | 'MISSING_METADATA_PROOF' | 'ARTIFACT_CONFLICT' | 'VIEW_CONFLICT' | 'INSTALL_LIMIT' | 'INVALID_LIBRARY' | 'INVALID_ARTIFACT';
/** Bounded validation failure without upstream text or machine paths. */
export class InstallPlanError extends Error {
  readonly category = 'validation';
  constructor(readonly code: InstallPlanCode) { super(code); this.name = 'InstallPlanError'; }
}
export interface AssetObject { name: string; sha1: string; size: number }
export interface AssetIndexContent { objects: AssetObject[]; virtual: boolean; mapToResources: boolean }

/** Validates a relative logical entry on Windows without accessing the filesystem. */
export function installRelativePath(value: string): string {
  try {
    if (value.length === 0 || value.length > 1024 || value.includes('\\')) throw new InstallPlanError('INVALID_INSTALL_PATH');
    value.split('/').forEach(validateComponent); return value;
  } catch { throw new InstallPlanError('INVALID_INSTALL_PATH'); }
}

/** Parses an official asset index, keeping logical names separate from physical content identity. */
export function parseAssetIndex(value: unknown): AssetIndexContent {
  if (!record(value) || !record(value.objects) || Object.keys(value.objects).length > 100000
    || value.virtual !== undefined && typeof value.virtual !== 'boolean'
    || value.map_to_resources !== undefined && typeof value.map_to_resources !== 'boolean') throw new InstallPlanError('INVALID_ASSET_INDEX');
  const names = new Set<string>(); const sizes = new Map<string, number>(); const objects: AssetObject[] = [];
  for (const [name, entry] of Object.entries(value.objects)) {
    installRelativePath(name); const folded = name.toLowerCase();
    if (names.has(folded) || !record(entry) || !Object.hasOwn(entry, 'hash') || !Object.hasOwn(entry, 'size')
      || typeof entry.hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(entry.hash)
      || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 64 * 1024 ** 3) throw new InstallPlanError('INVALID_ASSET_INDEX');
    const sha1 = entry.hash.toLowerCase();
    if (sizes.has(sha1) && sizes.get(sha1) !== entry.size) throw new InstallPlanError('ARTIFACT_CONFLICT');
    names.add(folded); sizes.set(sha1, entry.size); objects.push({ name, sha1, size: entry.size });
  }
  for (const object of objects) {
    const parts = object.name.toLowerCase().split('/'); parts.pop();
    while (parts.length) {
      if (names.has(parts.join('/'))) throw new InstallPlanError('INVALID_ASSET_INDEX');
      parts.pop();
    }
  }
  return { objects, virtual: value.virtual ?? false, mapToResources: value.map_to_resources ?? false };
}
