import { parse } from 'smol-toml';
import { emptyDeclarations, modId, modObject, modRange, modText, modVersion } from './declarations.js';
import type { ModDeclarations, ModDependency } from './declarations.js';

/** Parses standard TOML (including multi-Mod files). Unresolved substitutions stay unknown, never guessed. */
export function parseTomlModDeclarations(format: 'forge' | 'neoforge', body: string): ModDeclarations {
  const result = emptyDeclarations(format);
  try {
    if (body.length > 1024 ** 2) throw new Error('LIMIT');
    const value: unknown = parse(body);
    if (!modObject(value) || !Array.isArray(value.mods) || !value.mods.length || value.mods.length > 256) throw new Error('INVALID');
    if (modText(value.modLoader)) {
      result.language = { id: value.modLoader, range: modRange(value.loaderVersion) };
      if (!['javafml', 'lowcodefml'].includes(value.modLoader)) result.issues.push('UNKNOWN_LANGUAGE_LOADER');
      if (result.language.range === null) result.issues.push('UNKNOWN_LANGUAGE_RANGE');
    } else result.issues.push('UNKNOWN_LANGUAGE_LOADER');
    for (const raw of value.mods) {
      if (!modObject(raw) || !modId(raw.modId, format)) { result.issues.push('UNKNOWN_MOD_ID'); continue; }
      const issues: string[] = []; const version = modVersion(raw.version ?? '1', issues);
      const dependencies: ModDependency[] = [];
      const rawDependencies = modObject(value.dependencies) ? value.dependencies[raw.modId] : undefined;
      if (rawDependencies !== undefined) {
        if (!Array.isArray(rawDependencies) || rawDependencies.length > 256) issues.push('UNKNOWN_DEPENDENCIES');
        else for (const item of rawDependencies) {
          if (!modObject(item) || !modId(item.modId, format)) { issues.push('UNKNOWN_DEPENDENCY_ID'); continue; }
          const dependency: ModDependency = { id: item.modId, range: null, kind: 'required', client: 'yes', issues: [] };
          if (format === 'forge') {
            if (typeof item.mandatory !== 'boolean') dependency.issues.push('UNKNOWN_REQUIREMENT');
            else dependency.kind = item.mandatory ? 'required' : 'optional';
          } else if (item.type === undefined || item.type === 'required') dependency.kind = 'required';
          else if (item.type === 'optional' || item.type === 'incompatible' || item.type === 'discouraged') dependency.kind = item.type;
          else dependency.issues.push('UNKNOWN_REQUIREMENT');
          const range = item.versionRange ?? (format === 'forge' ? '' : '*');
          dependency.range = typeof range === 'string' ? modRange(range === '' && format === 'forge' ? '*' : range) : null;
          if (dependency.range === null) dependency.issues.push('UNKNOWN_RANGE');
          if (item.side === 'SERVER') dependency.client = 'no';
          else if (item.side !== undefined && item.side !== 'BOTH' && item.side !== 'CLIENT') { dependency.client = 'unknown'; dependency.issues.push('UNKNOWN_ENVIRONMENT'); }
          if (item.ordering !== undefined && !['NONE', 'BEFORE', 'AFTER'].includes(String(item.ordering))) dependency.issues.push('UNKNOWN_ORDERING');
          // Preserve an explicit limitation rather than lose ordering constraints in a future solver.
          else if (item.ordering === 'BEFORE' || item.ordering === 'AFTER') dependency.issues.push('ORDERING_REQUIRES_CHECK');
          dependencies.push(dependency);
        }
      }
      if (raw.features !== undefined) {
        if (!modObject(raw.features)) issues.push('UNKNOWN_FEATURES');
        else for (const [key, range] of Object.entries(raw.features)) {
          if (key !== 'java_version') { issues.push('UNKNOWN_FEATURE'); continue; }
          const constraint = typeof range === 'string' ? modRange(range) : null;
          dependencies.push({ id: 'java', range: constraint, kind: 'required', client: 'yes', issues: constraint ? [] : ['UNKNOWN_RANGE'] });
        }
      }
      result.mods.push({ id: raw.modId, version, name: modText(raw.displayName, 256) ? raw.displayName : raw.modId,
        client: 'yes', provides: [], dependencies, issues });
    }
    if (value.dependencies !== undefined) {
      if (!modObject(value.dependencies)) result.issues.push('UNKNOWN_DEPENDENCIES');
      else if (Object.keys(value.dependencies).some(id => !result.mods.some(mod => mod.id === id))) result.issues.push('UNKNOWN_DEPENDENCY_OWNER');
    }
    if (value.features !== undefined) result.issues.push('UNKNOWN_FILE_FEATURES');
    return result;
  } catch { return emptyDeclarations(format, 'MALFORMED_DECLARATION'); }
}
