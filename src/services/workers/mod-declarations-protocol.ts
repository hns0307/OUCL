import { exactObject } from '../../shared/contracts/handshake.js';
import { modId, modNested, modRange, modText } from '../../core/mods/declarations.js';
import type { ModDeclarations, ModFormat } from '../../core/mods/declarations.js';

const issues = (value: unknown): boolean => Array.isArray(value) && value.length <= 2048
  && value.every(item => typeof item === 'string' && /^[A-Z_]{1,64}$/.test(item));
const client = (value: unknown): boolean => typeof value === 'string' && ['yes', 'no', 'unknown'].includes(value);
const version = (value: unknown): boolean => value === null || modText(value) && !value.includes('${');
const range = (value: unknown): boolean => value === null || modRange(value) !== null;
function invalid(): never { throw new Error('INVALID_MESSAGE'); }

/** Bounded private facts validation, independent of heavy JSON/TOML parsing in the worker. */
export function parseModDeclarationFacts(value: unknown): ModDeclarations {
  if (!exactObject(value, ['format', 'mods', 'nested', 'language', 'issues']) || typeof value.format !== 'string'
    || !['fabric', 'quilt', 'forge', 'neoforge'].includes(value.format) || !issues(value.issues)
    || !Array.isArray(value.mods) || value.mods.length > 256 || !Array.isArray(value.nested)) invalid();
  const format = value.format as ModFormat; const pathIssues: string[] = [];
  if (modNested(value.nested, false, pathIssues).length !== value.nested.length || pathIssues.length) invalid();
  if (value.language !== null && (!exactObject(value.language, ['id', 'range']) || !modText(value.language.id) || !range(value.language.range))) invalid();
  for (const mod of value.mods) {
    if (!exactObject(mod, ['id', 'version', 'name', 'client', 'provides', 'dependencies', 'issues']) || !modId(mod.id, format)
      || !version(mod.version) || !modText(mod.name, 256) || !client(mod.client) || !issues(mod.issues)
      || !Array.isArray(mod.provides) || mod.provides.length > 128 || !Array.isArray(mod.dependencies) || mod.dependencies.length > 257) invalid();
    for (const provide of mod.provides) if (!exactObject(provide, ['id', 'version']) || !modId(provide.id, format) || !version(provide.version)) invalid();
    for (const dependency of mod.dependencies) {
      if (!exactObject(dependency, ['id', 'range', 'kind', 'client', 'issues']) || !modId(dependency.id, format)
        || !range(dependency.range) || typeof dependency.kind !== 'string' || !['required', 'optional', 'incompatible', 'discouraged'].includes(dependency.kind)
        || !client(dependency.client) || !issues(dependency.issues)) invalid();
    }
  }
  return value as unknown as ModDeclarations;
}
