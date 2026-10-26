import { matchesModRange } from './ranges.js';
import type { Compatibility } from './ranges.js';
import type { DeclaredMod, ModDeclarations, ModFormat, ModRange } from './declarations.js';

export interface LocalModArchive { entries: string[]; declarations: ModDeclarations[]; jarJar: boolean }
export interface LocalModFile { fileId: string; enabled: boolean; archives: LocalModArchive[]; issues: string[] }
export interface ModEnvironment {
  loader: ModFormat | 'vanilla';
  /** Explicit known runtime identities; null means its exact version was not measured. */
  versions: Record<string, string | null>;
  languageVersions: Record<string, string | null>;
}
export interface ModCheckIssue {
  severity: 'error' | 'unknown' | 'warning'; code: string; fileId: string; modId: string | null;
  dependencyId: string | null; expected: ModRange | null; actual: string[]; via: string[];
}
export interface ModProvider { fileId: string; id: string; version: string | null; ownerId: string; via: string[] }
export interface LocalModCheck { state: Compatibility; issues: ModCheckIssue[]; providers: ModProvider[] }
const RUNTIME_IDS = new Set(['minecraft', 'java', 'fabricloader', 'quilt_loader', 'forge', 'neoforge']);

/** Checks declared local requirements only. This neither identifies platform projects nor authorizes a write.
 * Unknowns remain blocking; disabled files and undeclared nested JARs never supply a provider.
 */
export function checkLocalMods(files: readonly LocalModFile[], environment: ModEnvironment): LocalModCheck {
  const issues: ModCheckIssue[] = []; const providers: ModProvider[] = [];
  const mods: Array<{ fileId: string; mod: DeclaredMod; format: ModFormat; via: string[] }> = [];
  const add = (severity: ModCheckIssue['severity'], code: string, fileId: string, modId: string | null = null,
    dependencyId: string | null = null, expected: ModRange | null = null, actual: string[] = [], via: string[] = []): void => {
    if (issues.length >= 4096) return;
    if (issues.length === 4095) { issues.push({ severity: 'unknown', code: 'REPORT_LIMIT', fileId: '', modId: null, dependencyId: null, expected: null, actual: [], via: [] }); return; }
    issues.push({ severity, code, fileId, modId, dependencyId, expected, actual, via });
  };
  const selected = (archive: LocalModArchive): ModDeclarations | undefined => {
    if (environment.loader === 'vanilla') return undefined;
    return archive.declarations.find(item => item.format === environment.loader)
      ?? (environment.loader === 'quilt' ? archive.declarations.find(item => item.format === 'fabric') : undefined);
  };
  const compare = (range: ModRange | null, version: string | null | undefined, format: ModFormat): Compatibility => {
    if (range === null || version === null || version === undefined) return 'unknown';
    return matchesModRange(range, version, format === 'forge' || format === 'neoforge' ? 'maven' : format);
  };
  if (files.length > 256) add('unknown', 'INSTANCE_MOD_LIMIT', '');
  for (const file of files.slice(0, 256)) {
    if (!file.enabled) continue;
    for (const issue of file.issues) add('unknown', issue, file.fileId);
    const root = file.archives.find(archive => archive.entries.length === 0);
    if (!root || file.archives.length > 64) { add('unknown', 'UNKNOWN_ARCHIVE', file.fileId); continue; }
    const visited = new Set<string>();
    const visit = (archive: LocalModArchive): void => {
      const identity = JSON.stringify(archive.entries);
      if (visited.has(identity)) return; visited.add(identity);
      if (archive.entries.length > 4 || visited.size > 64) { add('unknown', 'NESTED_MOD_LIMIT', file.fileId); return; }
      const facts = selected(archive); const via = [...archive.entries];
      if (!facts) {
        add(archive.declarations.length ? 'error' : 'unknown', archive.declarations.length ? 'LOADER_MISMATCH' : 'UNKNOWN_DECLARATION', file.fileId, null, null, null, [], via); return;
      }
      for (const issue of facts.issues) add('unknown', issue, file.fileId, null, null, null, [], via);
      if (!facts.mods.length && !facts.issues.length) add('unknown', 'UNKNOWN_DECLARATION', file.fileId, null, null, null, [], via);
      if (archive.jarJar) add('unknown', 'JARJAR_SELECTION_REQUIRES_CHECK', file.fileId, null, null, null, [], via);
      for (const mod of facts.mods) {
        if (mod.client === 'no') { add('warning', 'SERVER_ONLY_MOD', file.fileId, mod.id, null, null, [], via); continue; }
        if (mod.client === 'unknown') { add('unknown', 'UNKNOWN_ENVIRONMENT', file.fileId, mod.id, null, null, [], via); continue; }
        if (mods.length >= 256) { add('unknown', 'INSTANCE_MOD_LIMIT', file.fileId); break; }
        for (const issue of mod.issues) add('unknown', issue, file.fileId, mod.id, null, null, [], via);
        mods.push({ fileId: file.fileId, mod, format: facts.format, via });
        providers.push({ fileId: file.fileId, id: mod.id, ownerId: mod.id, version: mod.version, via });
        for (const alias of mod.provides) providers.push({ fileId: file.fileId, id: alias.id, ownerId: mod.id, version: alias.version, via });
        if (facts.language) {
          const actual = environment.languageVersions[facts.language.id]; const outcome = compare(facts.language.range, actual, facts.format);
          if (outcome !== 'satisfied') add(outcome === 'unknown' ? 'unknown' : 'error', 'LANGUAGE_REQUIREMENT', file.fileId, mod.id,
            facts.language.id, facts.language.range, actual ? [actual] : [], via);
        }
      }
      // A server-only outer mod does not make its embedded files client providers.
      if (!facts.mods.some(mod => mod.client === 'yes')) return;
      for (const path of facts.nested) {
        const chain = [...archive.entries, path];
        const matches = file.archives.filter(child => JSON.stringify(child.entries) === JSON.stringify(chain));
        if (matches.length !== 1) add('unknown', 'NESTED_DECLARATION_MISSING', file.fileId, null, null, null, [], chain);
        else visit(matches[0]!);
      }
    };
    visit(root);
  }
  const byId = new Map<string, ModProvider[]>();
  for (const provider of providers) { const group = byId.get(provider.id) ?? []; group.push(provider); byId.set(provider.id, group); }
  for (const [id, group] of byId) {
    if (group.length > 1 || RUNTIME_IDS.has(id)) for (const provider of group) add('error', 'DUPLICATE_MOD_ID', provider.fileId, provider.ownerId, id, null,
      group.map(item => item.version ?? '?'), provider.via);
  }
  for (const { fileId, mod, format, via } of mods) {
    for (const dependency of mod.dependencies) {
      if (dependency.client === 'no') continue;
      if (dependency.client === 'unknown') { add('unknown', 'UNKNOWN_DEPENDENCY_ENVIRONMENT', fileId, mod.id, dependency.id, dependency.range, [], via); continue; }
      for (const issue of dependency.issues) add('unknown', issue, fileId, mod.id, dependency.id, dependency.range, [], via);
      const runtime = RUNTIME_IDS.has(dependency.id); const group = runtime ? [] : byId.get(dependency.id) ?? [];
      const present = runtime ? Object.hasOwn(environment.versions, dependency.id) : group.length > 0;
      if (!present) {
        if (dependency.kind === 'required') add('error', runtime ? 'RUNTIME_DEPENDENCY_MISSING' : 'MOD_DEPENDENCY_MISSING', fileId, mod.id, dependency.id, dependency.range, [], via);
        continue;
      }
      if (!runtime && group.length > 1) continue;
      const actual = runtime ? environment.versions[dependency.id] : group[0]!.version;
      const outcome = compare(dependency.range, actual, format);
      if (outcome === 'unknown') add('unknown', 'UNKNOWN_DEPENDENCY_RANGE', fileId, mod.id, dependency.id, dependency.range, actual ? [actual] : [], via);
      else if (dependency.kind === 'required' || dependency.kind === 'optional') {
        if (outcome === 'unsatisfied') add('error', 'DEPENDENCY_VERSION_MISMATCH', fileId, mod.id, dependency.id, dependency.range, actual ? [actual] : [], via);
      } else if (outcome === 'satisfied') add(dependency.kind === 'incompatible' ? 'error' : 'warning', dependency.kind === 'incompatible' ? 'MOD_CONFLICT' : 'MOD_DISCOURAGED',
        fileId, mod.id, dependency.id, dependency.range, actual ? [actual] : [], via);
    }
  }
  return { state: issues.some(issue => issue.severity === 'error') ? 'unsatisfied' : issues.some(issue => issue.severity === 'unknown') ? 'unknown' : 'satisfied', issues, providers };
}
