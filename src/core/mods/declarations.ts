import { installRelativePath } from '../install/assets.js';

export type ModFormat = 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type ModRange = string | ModRange[] | { any: ModRange[] } | { all: ModRange[] };
export type ClientApplicability = 'yes' | 'no' | 'unknown';
export interface ModDependency {
  id: string; range: ModRange | null; kind: 'required' | 'optional' | 'incompatible' | 'discouraged';
  client: ClientApplicability; issues: string[];
}
export interface DeclaredMod {
  id: string; version: string | null; name: string; client: ClientApplicability;
  provides: Array<{ id: string; version: string | null }>; dependencies: ModDependency[]; issues: string[];
}
export interface ModDeclarations {
  format: ModFormat; mods: DeclaredMod[]; nested: string[];
  language: { id: string; range: ModRange | null } | null; issues: string[];
}
/** Only bounded plain metadata objects are accepted; no prototype-derived identity. */
export function modObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function modText(value: unknown, maximum = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && ![...value].some(character => character.charCodeAt(0) < 32);
}
export function modId(value: unknown, format: ModFormat): value is string {
  return typeof value === 'string' && (format === 'forge' || format === 'neoforge'
    ? /^[a-z][a-z0-9_]{1,63}$/ : /^[a-z][a-z0-9_-]{1,63}$/).test(value);
}
export function modVersion(value: unknown, issues: string[]): string | null {
  if (!modText(value) || value.includes('${')) { issues.push('UNKNOWN_VERSION'); return null; } return value;
}
/** Normalizes shape only; unsupported operators remain visible to the dialect matcher as unknown. */
export function modRange(value: unknown, depth = 0, budget = { nodes: 0 }): ModRange | null {
  if (depth > 16 || ++budget.nodes > 256) return null;
  if (modText(value, 2048) && !value.includes('${')) return value;
  if (Array.isArray(value)) {
    if (!value.length || value.length > 128) return null;
    const children = value.map(item => modRange(item, depth + 1, budget));
    return children.every((item): item is ModRange => item !== null) ? children : null;
  }
  if (modObject(value) && Object.keys(value).length === 1) {
    const key = Object.keys(value)[0]!;
    if (key !== 'any' && key !== 'all' || !Array.isArray(value[key])) return null;
    const list = modRange(value[key], depth + 1, budget); if (!Array.isArray(list)) return null;
    return key === 'any' ? { any: list } : { all: list };
  }
  return null;
}
export function modNested(value: unknown, objectEntries: boolean, issues: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) { issues.push('UNKNOWN_NESTED_JARS'); return []; }
  const result: string[] = [];
  for (const item of value) {
    const name = objectEntries && modObject(item) ? item.file : item;
    try {
      if (!modText(name, 4096) || !name.endsWith('.jar')) throw new Error('INVALID');
      installRelativePath(name); if (result.includes(name)) throw new Error('DUPLICATE'); result.push(name);
    } catch { issues.push('UNKNOWN_NESTED_JARS'); }
  }
  return result;
}
export function modClient(value: unknown, serverName: string): ClientApplicability {
  return value === undefined || value === '*' || value === 'client' ? 'yes' : value === serverName ? 'no' : 'unknown';
}
export function emptyDeclarations(format: ModFormat, issue?: string): ModDeclarations {
  return { format, mods: [], nested: [], language: null, issues: issue ? [issue] : [] };
}
