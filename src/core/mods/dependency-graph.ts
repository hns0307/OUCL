import type { PlatformDependency, PlatformModVersion } from './platform.js';
import type { ModFormat } from './declarations.js';

export interface DependencyGraphInput {
  roots: readonly string[];
  selected: readonly PlatformModVersion[];
  installed: readonly PlatformModVersion[];
  minecraft: string;
  loader: ModFormat;
  unknownInstalled: boolean;
}
export interface DependencyGraphIssue {
  severity: 'conflict' | 'unknown';
  code: 'MISSING_CANDIDATE' | 'PIN_CONFLICT' | 'PROJECT_CONFLICT' | 'INSTALLED_CONFLICT' | 'INCOMPATIBLE'
    | 'UNRESOLVED_IDENTITY' | 'CYCLE' | 'DEPTH_LIMIT' | 'PROJECT_LIMIT' | 'UNKNOWN_INSTALLED' | 'TARGET_CONFLICT' | 'FILE_SELECTION'
    | 'SEARCH_LIMIT' | 'NO_SOLUTION';
  projectId: string | null;
  versionId: string | null;
  requiredBy: string[];
}
export interface DependencyGraphNode {
  projectId: string; versionId: string; disposition: 'reuse' | 'candidate'; requiredBy: string[];
  filename: string | null; sha512: string | null;
}
export interface DependencyGraphResult {
  state: 'resolved' | 'conflict' | 'unknown'; nodes: DependencyGraphNode[]; issues: DependencyGraphIssue[];
}

/** Validates an explicitly selected platform snapshot without IO or permission to install.
 * Missing candidates remain explicit queries. Existing projects are immutable; JAR declarations,
 * hash rechecks, session/revision checks and player confirmation must still precede any write.
 */
export function inspectDependencyGraph(input: DependencyGraphInput): DependencyGraphResult {
  const issues: DependencyGraphIssue[] = []; const nodes = new Map<string, DependencyGraphNode>();
  const selected = new Map<string, PlatformModVersion>(); const installed = new Map<string, PlatformModVersion>();
  const versions = new Map<string, PlatformModVersion>(); const pins = new Map<string, string>();
  const visiting = new Set<string>(); const visitedDepth = new Map<string, number>();
  const add = (severity: DependencyGraphIssue['severity'], code: DependencyGraphIssue['code'], projectId: string | null,
    versionId: string | null, chain: readonly string[]): void => {
    if (issues.length >= 512) return;
    issues.push({ severity, code, projectId, versionId, requiredBy: [...chain] });
  };
  if (input.unknownInstalled) add('unknown', 'UNKNOWN_INSTALLED', null, null, []);
  if (!input.roots.length) add('unknown', 'UNRESOLVED_IDENTITY', null, null, []);
  if (input.selected.length + input.installed.length > 512 || input.roots.length > 256) {
    add('unknown', 'PROJECT_LIMIT', null, null, []); return { state: 'unknown', nodes: [], issues };
  }
  for (const [values, map] of [[input.installed, installed], [input.selected, selected]] as const) {
    for (const version of values) {
      const previous = map.get(version.projectId);
      if (previous && previous.versionId !== version.versionId) add('conflict', 'PROJECT_CONFLICT', version.projectId, version.versionId, []);
      else map.set(version.projectId, version);
      const byId = versions.get(version.versionId);
      if (byId && (byId.projectId !== version.projectId || JSON.stringify(byId) !== JSON.stringify(version))) add('conflict', 'PROJECT_CONFLICT', version.projectId, version.versionId, []);
      else versions.set(version.versionId, version);
    }
  }
  for (const [project, version] of selected) {
    const old = installed.get(project);
    if (old && old.versionId !== version.versionId) add('conflict', 'INSTALLED_CONFLICT', project, version.versionId, []);
  }
  const chosen = (project: string): PlatformModVersion | undefined => selected.get(project) ?? installed.get(project);
  const identity = (dependency: PlatformDependency): string | null => dependency.projectId
    ?? (dependency.versionId ? versions.get(dependency.versionId)?.projectId ?? null : null);
  const visit = (version: PlatformModVersion, chain: readonly string[]): void => {
    const project = version.projectId; const path = [...chain, project];
    const old = installed.get(project);
    if (old && old.versionId !== version.versionId) add('conflict', 'INSTALLED_CONFLICT', project, version.versionId, path);
    const node = nodes.get(project);
    if (node && chain.length && !node.requiredBy.includes(chain.at(-1)!)) node.requiredBy.push(chain.at(-1)!);
    if (chain.length >= 32) { add('unknown', 'DEPTH_LIMIT', project, version.versionId, path); return; }
    if (visiting.has(project)) { add('conflict', 'CYCLE', project, version.versionId, path); return; }
    if ((visitedDepth.get(project) ?? -1) >= chain.length) return;
    if (!node && nodes.size >= 256) { add('unknown', 'PROJECT_LIMIT', project, version.versionId, path); return; }
    if (!version.gameVersions.includes(input.minecraft) || !version.loaders.includes(input.loader)
      || ['server_only', 'dedicated_server_only'].includes(version.environment)) add('conflict', 'TARGET_CONFLICT', project, version.versionId, path);
    const primary = version.files.filter(file => file.primary); const file = primary.length === 1 ? primary[0] : version.files.length === 1 ? version.files[0] : undefined;
    if (!file) add('unknown', 'FILE_SELECTION', project, version.versionId, path);
    if (!node) nodes.set(project, { projectId: project, versionId: version.versionId, disposition: old?.versionId === version.versionId ? 'reuse' : 'candidate',
      requiredBy: chain.length ? [chain.at(-1)!] : [], filename: file?.filename ?? null, sha512: file?.sha512 ?? null });
    visiting.add(project);
    for (const dependency of version.dependencies) {
      if (dependency.type === 'optional' || dependency.type === 'embedded') continue;
      const target = identity(dependency);
      if (!target) { add('unknown', 'UNRESOLVED_IDENTITY', null, dependency.versionId, path); continue; }
      const candidate = chosen(target);
      if (dependency.type === 'incompatible') {
        if (candidate && (!dependency.versionId || candidate.versionId === dependency.versionId)) add('conflict', 'INCOMPATIBLE', target, candidate.versionId, path);
        continue;
      }
      if (dependency.versionId) {
        const previous = pins.get(target);
        if (previous && previous !== dependency.versionId) add('conflict', 'PIN_CONFLICT', target, dependency.versionId, path);
        pins.set(target, dependency.versionId);
      }
      if (!candidate) { add('unknown', 'MISSING_CANDIDATE', target, dependency.versionId, path); continue; }
      if (dependency.versionId && candidate.versionId !== dependency.versionId) add('conflict', 'PIN_CONFLICT', target, dependency.versionId, path);
      visit(candidate, path);
    }
    visiting.delete(project); visitedDepth.set(project, chain.length);
  };
  for (const id of [...new Set(input.roots)].sort()) {
    const root = versions.get(id);
    if (!root) add('unknown', 'MISSING_CANDIDATE', null, id, []);
    else if (chosen(root.projectId)?.versionId !== id) add('conflict', 'PROJECT_CONFLICT', root.projectId, id, []);
    else visit(root, []);
  }
  const result = [...nodes.values()].sort((a, b) => a.projectId.localeCompare(b.projectId));
  for (const node of result) node.requiredBy.sort();
  return { state: issues.some(issue => issue.severity === 'conflict') ? 'conflict' : issues.length ? 'unknown' : 'resolved', nodes: result, issues };
}
