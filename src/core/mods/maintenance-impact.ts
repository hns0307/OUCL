import { checkLocalMods } from './check.js';
import type { LocalModCheck, LocalModFile, ModEnvironment, ModProvider } from './check.js';
import { checkPlatformMods } from './platform.js';
import type { DualModCheck, PlatformLocalMod, PlatformModVersion } from './platform.js';

export interface MaintenanceInventoryFile extends LocalModFile { platform: PlatformLocalMod }
export interface MaintenanceAssessment { local: LocalModCheck; platform: DualModCheck }
export interface MaintenanceFinding {
  scope: 'local' | 'platform';
  issue: LocalModCheck['issues'][number] | DualModCheck['issues'][number];
}
export interface MaintenanceRelation {
  scope: 'local' | 'platform'; dependentFileId: string; providerFileId: string;
  /** Local Mod ID or platform project/version selector; never conflates the namespaces. */
  selector: string; optional: boolean; via: string[];
}
export interface MaintenanceImpact {
  action: 'enable' | 'disable'; fileId: string; state: 'ready' | 'blocked' | 'unknown';
  before: MaintenanceAssessment; after: MaintenanceAssessment;
  introducedIssues: MaintenanceFinding[]; resolvedIssues: MaintenanceFinding[];
  affectedProviders: ModProvider[]; directRequiredBy: string[]; transitiveRequiredBy: string[];
  relations: MaintenanceRelation[]; truncated: boolean;
}
const MAX_RELATIONS = 512;
const RUNTIME_IDS = new Set(['minecraft', 'java', 'fabricloader', 'quilt_loader', 'forge', 'neoforge']);
const findings = (assessment: MaintenanceAssessment): MaintenanceFinding[] => [
  ...assessment.local.issues.map(issue => ({ scope: 'local' as const, issue })),
  ...assessment.platform.issues.map(issue => ({ scope: 'platform' as const, issue })),
];
const key = (value: unknown): string => JSON.stringify(value);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** Predicts a single root-JAR activation change from one already validated inventory snapshot.
 * This pure preview neither verifies ownership/content nor authorizes a filesystem operation.
 * Both checkers see the same activation set; any pre-existing error/unknown remains blocking.
 */
export function previewModMaintenance(files: readonly MaintenanceInventoryFile[], environment: ModEnvironment,
  versionsByHash: ReadonlyMap<string, PlatformModVersion>, fileId: string, action: 'enable' | 'disable'): MaintenanceImpact {
  if (action !== 'enable' && action !== 'disable' || files.length > 256 || !fileId
    || new Set(files.map(file => file.fileId)).size !== files.length
    || files.some(file => !file.fileId || file.platform.fileId !== file.fileId || file.platform.enabled !== file.enabled)) {
    throw new Error('INVALID_MAINTENANCE_SNAPSHOT');
  }
  const selected = files.find(file => file.fileId === fileId);
  if (!selected || selected.enabled === (action === 'enable')) throw new Error('INVALID_MAINTENANCE_TARGET');
  // Clone metadata: consumers can mutate a returned preview without changing the input inventory.
  const beforeFiles = structuredClone([...files]);
  const afterFiles = beforeFiles.map(file => file.fileId === fileId
    ? { ...file, enabled: action === 'enable', platform: { ...file.platform, enabled: action === 'enable' } } : file);
  const assess = (items: MaintenanceInventoryFile[]): MaintenanceAssessment => {
    const local = checkLocalMods(items, environment);
    return { local, platform: checkPlatformMods(local.state, items.map(file => file.platform), environment, versionsByHash) };
  };
  const before = assess(beforeFiles); const after = assess(afterFiles);
  const beforeFindings = findings(before); const afterFindings = findings(after);
  const beforeKeys = new Set(beforeFindings.map(key)); const afterKeys = new Set(afterFindings.map(key));
  // For disable use the old activation graph; for enable use the prospective one.
  const graph = action === 'disable' ? before : after;
  const graphFiles = action === 'disable' ? beforeFiles : afterFiles;
  const relations: MaintenanceRelation[] = []; const seen = new Set<string>(); let truncated = false;
  const add = (relation: MaintenanceRelation): void => {
    const identity = key(relation); if (seen.has(identity)) return; seen.add(identity);
    if (relations.length >= MAX_RELATIONS) { truncated = true; return; }
    relations.push(relation);
  };
  for (const file of graphFiles) {
    if (!file.enabled) continue;
    for (const archive of file.archives) {
      // Only declarations visited by the real checker supply dependency edges (including nested JARs).
      const providers = graph.local.providers.filter(provider => provider.fileId === file.fileId && key(provider.via) === key(archive.entries));
      const declaration = archive.declarations.find(item => item.format === environment.loader)
        ?? (environment.loader === 'quilt' ? archive.declarations.find(item => item.format === 'fabric') : undefined);
      for (const mod of declaration?.mods ?? []) {
        if (mod.client !== 'yes' || !providers.some(provider => provider.ownerId === mod.id)) continue;
        for (const dependency of mod.dependencies) {
          if (dependency.client === 'no' || RUNTIME_IDS.has(dependency.id)
            || dependency.kind !== 'required' && dependency.kind !== 'optional') continue;
          // Keep all possible owners for duplicate/unknown providers; the checker blocks ambiguity.
          for (const provider of graph.local.providers.filter(item => item.id === dependency.id)) {
            add({ scope: 'local', dependentFileId: file.fileId, providerFileId: provider.fileId,
              selector: dependency.id, optional: dependency.kind === 'optional', via: [...archive.entries] });
          }
        }
      }
    }
  }
  const enabledIds = new Set(graphFiles.filter(file => file.enabled).map(file => file.fileId));
  const associations = graph.platform.files.filter(file => enabledIds.has(file.fileId) && file.version !== null);
  for (const dependent of associations) {
    for (const dependency of dependent.version!.dependencies) {
      if (dependency.type !== 'required' && dependency.type !== 'optional') continue;
      if (!dependency.projectId && !dependency.versionId) continue;
      for (const provider of associations) {
        if (dependency.projectId && provider.version!.projectId !== dependency.projectId
          || dependency.versionId && provider.version!.versionId !== dependency.versionId) continue;
        add({ scope: 'platform', dependentFileId: dependent.fileId, providerFileId: provider.fileId,
          selector: key({ projectId: dependency.projectId, versionId: dependency.versionId }),
          optional: dependency.type === 'optional', via: [] });
      }
    }
  }
  const direct = new Set(relations.filter(edge => !edge.optional && edge.providerFileId === fileId && edge.dependentFileId !== fileId)
    .map(edge => edge.dependentFileId));
  const reached = new Set([fileId]); const queue = [fileId];
  for (let index = 0; index < queue.length; index++) {
    for (const edge of relations) {
      if (edge.optional || edge.providerFileId !== queue[index] || reached.has(edge.dependentFileId)) continue;
      reached.add(edge.dependentFileId); queue.push(edge.dependentFileId);
    }
  }
  const states = [before.platform.state, after.platform.state];
  const result: MaintenanceImpact = {
    action, fileId, state: states.includes('unsatisfied') ? 'blocked' : truncated || states.includes('unknown') ? 'unknown' : 'ready',
    before, after, introducedIssues: afterFindings.filter(finding => !beforeKeys.has(key(finding))),
    resolvedIssues: beforeFindings.filter(finding => !afterKeys.has(key(finding))),
    affectedProviders: graph.local.providers.filter(provider => provider.fileId === fileId),
    directRequiredBy: sorted(direct), transitiveRequiredBy: sorted([...reached].filter(id => id !== fileId && !direct.has(id))),
    relations: relations.sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0), truncated,
  };
  return structuredClone(result);
}
