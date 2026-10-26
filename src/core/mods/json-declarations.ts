import { emptyDeclarations, modClient, modId, modNested, modObject, modRange, modText, modVersion } from './declarations.js';
import type { DeclaredMod, ModDeclarations, ModDependency } from './declarations.js';

/** Reads Fabric v1 and Quilt v1 facts without treating platform project identity as modId. */
export function parseJsonModDeclarations(format: 'fabric' | 'quilt', body: string): ModDeclarations {
  const result = emptyDeclarations(format);
  try {
    if (body.length > 1024 ** 2) throw new Error('LIMIT');
    const value: unknown = JSON.parse(body);
    if (!modObject(value)) throw new Error('INVALID');
    const fabric = format === 'fabric';
    if ((fabric ? value.schemaVersion : value.schema_version) !== 1) return emptyDeclarations(format, 'UNKNOWN_SCHEMA');
    const raw = fabric ? value : value.quilt_loader;
    if (!modObject(raw) || !modId(raw.id, format)) throw new Error('INVALID');
    if (!fabric && (!modText(raw.group) || !/^[a-zA-Z0-9_.-]+$/.test(raw.group))) result.issues.push('UNKNOWN_GROUP');
    const mod: DeclaredMod = { id: raw.id, version: modVersion(raw.version, result.issues), name: raw.id,
      client: modClient(fabric ? raw.environment : modObject(value.minecraft) ? value.minecraft.environment : undefined,
        fabric ? 'server' : 'dedicated_server'), provides: [], dependencies: [], issues: [] };
    const name = fabric ? raw.name : modObject(raw.metadata) ? raw.metadata.name : undefined;
    if (modText(name, 256)) mod.name = name;
    if (mod.client === 'unknown') mod.issues.push('UNKNOWN_ENVIRONMENT');
    result.mods.push(mod); result.nested = modNested(raw.jars, fabric, result.issues);
    if (raw.provides !== undefined) {
      if (!Array.isArray(raw.provides) || raw.provides.length > 128) mod.issues.push('UNKNOWN_PROVIDES');
      else for (const item of raw.provides) {
        const id = typeof item === 'string' ? item : !fabric && modObject(item) ? item.id : undefined;
        if (!modId(id, format)) { mod.issues.push('UNKNOWN_PROVIDES'); continue; }
        const version = !fabric && modObject(item) && item.version !== undefined ? modVersion(item.version, mod.issues) : mod.version;
        mod.provides.push({ id, version });
      }
    }
    if (fabric) {
      for (const [field, kind] of [['depends', 'required'], ['recommends', 'optional'], ['suggests', 'optional'],
        ['breaks', 'incompatible'], ['conflicts', 'discouraged']] as const) {
        const group = raw[field]; if (group === undefined) continue;
        if (!modObject(group) || Object.keys(group).length > 256) { mod.issues.push('UNKNOWN_DEPENDENCIES'); continue; }
        for (const [id, value] of Object.entries(group)) {
          if (!modId(id, format)) { mod.issues.push('UNKNOWN_DEPENDENCY_ID'); continue; }
          const range = typeof value === 'string' || Array.isArray(value) && value.every(item => typeof item === 'string') ? modRange(value) : null;
          mod.dependencies.push({ id, range, kind, client: 'yes', issues: range === null ? ['UNKNOWN_RANGE'] : [] });
        }
      }
    } else {
      if (raw.plugins !== undefined) mod.issues.push('UNKNOWN_LOADER_PLUGIN');
      for (const [field, kind] of [['depends', 'required'], ['breaks', 'incompatible']] as const) {
        const group = raw[field]; if (group === undefined) continue;
        if (!Array.isArray(group) || group.length > 256) { mod.issues.push('UNKNOWN_DEPENDENCIES'); continue; }
        for (const item of group) {
          // Nested alternatives, group-qualified IDs and conditional unless need their own solver.
          if (Array.isArray(item)) { mod.issues.push('UNKNOWN_DEPENDENCY_ALTERNATIVES'); continue; }
          const id = typeof item === 'string' ? item : modObject(item) ? item.id : undefined;
          if (!modId(id, format)) { mod.issues.push('UNKNOWN_DEPENDENCY_ID'); continue; }
          const range = modRange(modObject(item) && item.versions !== undefined ? item.versions : '*');
          const dependency: ModDependency = { id, range, kind, client: modClient(modObject(item) ? item.environment : undefined, 'dedicated_server'), issues: [] };
          if (range === null) dependency.issues.push('UNKNOWN_RANGE');
          if (dependency.client === 'unknown') dependency.issues.push('UNKNOWN_ENVIRONMENT');
          if (modObject(item)) {
            if (item.optional === true && kind === 'required') dependency.kind = 'optional';
            else if (item.optional !== undefined && item.optional !== false) dependency.issues.push('UNKNOWN_OPTIONAL_CONDITION');
            if (item.unless !== undefined) dependency.issues.push('UNKNOWN_UNLESS_CONDITION');
          }
          mod.dependencies.push(dependency);
        }
      }
    }
    return result;
  } catch { return emptyDeclarations(format, 'MALFORMED_DECLARATION'); }
}
