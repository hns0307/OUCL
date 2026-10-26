import type { Compatibility } from './ranges.js';
import type { ModEnvironment } from './check.js';
import type { ModFormat } from './declarations.js';

export interface PlatformDependency { projectId: string | null; versionId: string | null; filename: string | null; type: 'required' | 'optional' | 'incompatible' | 'embedded' }
export interface PlatformModFile { filename: string; size: number; sha1: string; sha512: string; url: string; primary: boolean }
export interface PlatformModVersion {
  projectId: string; versionId: string; name: string; versionNumber: string; release: 'release' | 'beta' | 'alpha'; publishedAt: string;
  loaders: string[]; gameVersions: string[]; environment: string; dependencies: PlatformDependency[]; files: PlatformModFile[];
  evidence: { url: string; sha256: string };
}
export interface PlatformLocalMod {
  fileId: string; enabled: boolean; size: number | null; sha1: string | null; sha512: string | null;
  formats: ModFormat[]; unresolvedEmbedded: boolean;
}
export interface PlatformCheckIssue {
  severity: 'error' | 'unknown'; code: string; fileId: string; projectId: string | null;
  dependencyProjectId: string | null; dependencyVersionId: string | null; versionId: string | null;
}
export interface PlatformAssociation { fileId: string; status: 'matched' | 'unknown' | 'conflict'; version: PlatformModVersion | null }
export interface DualModCheck { state: Compatibility; files: PlatformAssociation[]; issues: PlatformCheckIssue[] }

/** Combines source evidence with local facts. A project version number is never substituted for a JAR-declared Mod version. */
export function checkPlatformMods(localState: Compatibility, files: readonly PlatformLocalMod[], environment: ModEnvironment,
  versionsByHash: ReadonlyMap<string, PlatformModVersion>): DualModCheck {
  const issues: PlatformCheckIssue[] = []; const associations: PlatformAssociation[] = [];
  const add = (severity: PlatformCheckIssue['severity'], code: string, fileId: string, version: PlatformModVersion | null,
    dependency?: PlatformDependency): void => {
    if (issues.length >= 4096) return;
    if (issues.length === 4095) { issues.push({ severity: 'unknown', code: 'REPORT_LIMIT', fileId: '', projectId: null, dependencyProjectId: null, dependencyVersionId: null, versionId: null }); return; }
    issues.push({ severity, code, fileId, projectId: version?.projectId ?? null, versionId: version?.versionId ?? null,
      dependencyProjectId: dependency?.projectId ?? null, dependencyVersionId: dependency?.versionId ?? null });
  };
  if (files.length > 256) add('unknown', 'INSTANCE_MOD_LIMIT', '', null);
  for (const file of files.slice(0, 256)) {
    const version = file.sha512 ? versionsByHash.get(file.sha512) ?? null : null;
    if (!version) { associations.push({ fileId: file.fileId, status: 'unknown', version: null }); if (file.enabled) add('unknown', 'PLATFORM_SOURCE_UNKNOWN', file.fileId, null); continue; }
    const matched = version.files.find(candidate => candidate.sha512 === file.sha512);
    let conflict = false;
    if (!matched || matched.sha1 !== file.sha1 || matched.size !== file.size) {
      conflict = true; if (file.enabled) add('error', 'PLATFORM_HASH_CONFLICT', file.fileId, version);
    }
    if (file.enabled) {
      const minecraft = environment.versions.minecraft;
      if (!minecraft) add('unknown', 'MINECRAFT_VERSION_UNKNOWN', file.fileId, version);
      else if (!version.gameVersions.includes(minecraft)) { conflict = true; add('error', 'PLATFORM_MINECRAFT_CONFLICT', file.fileId, version); }
      if (!version.loaders.includes(environment.loader)) {
        if (environment.loader === 'quilt' && version.loaders.includes('fabric')) add('unknown', 'PLATFORM_QUILT_UNVERIFIED', file.fileId, version);
        else { conflict = true; add('error', 'PLATFORM_LOADER_CONFLICT', file.fileId, version); }
      }
      if (environment.loader === 'vanilla' || !file.formats.includes(environment.loader)
        && !(environment.loader === 'quilt' && file.formats.includes('fabric'))) { conflict = true; add('error', 'LOCAL_LOADER_CONFLICT', file.fileId, version); }
      if (version.environment === 'server_only' || version.environment === 'dedicated_server_only') { conflict = true; add('error', 'PLATFORM_CLIENT_CONFLICT', file.fileId, version); }
      else if (!['client_and_server', 'client_only', 'client_only_server_optional', 'singleplayer_only',
        'server_only_client_optional', 'client_or_server', 'client_or_server_prefers_both'].includes(version.environment)) add('unknown', 'PLATFORM_ENVIRONMENT_UNKNOWN', file.fileId, version);
    }
    associations.push({ fileId: file.fileId, version, status: conflict ? 'conflict' : 'matched' });
  }
  const enabled = new Set(files.filter(file => file.enabled).map(file => file.fileId));
  const known = associations.filter(item => enabled.has(item.fileId) && item.version !== null);
  const projects = new Map<string, PlatformAssociation[]>();
  for (const item of known) { const group = projects.get(item.version!.projectId) ?? []; group.push(item); projects.set(item.version!.projectId, group); }
  for (const group of projects.values()) if (group.length > 1) for (const item of group) add('error', 'DUPLICATE_PROJECT', item.fileId, item.version);
  const unresolved = files.some(file => file.enabled && file.unresolvedEmbedded)
    || associations.some(item => enabled.has(item.fileId) && item.status !== 'matched');
  for (const item of known) {
    for (const dependency of item.version!.dependencies) {
      if (dependency.type === 'embedded') { add('unknown', 'EMBEDDED_PROJECT_UNRESOLVED', item.fileId, item.version, dependency); continue; }
      if (dependency.projectId === null && dependency.versionId === null) { add('unknown', 'PLATFORM_DEPENDENCY_ID_UNKNOWN', item.fileId, item.version, dependency); continue; }
      const matching = known.filter(candidate => (!dependency.projectId || candidate.version!.projectId === dependency.projectId)
        && (!dependency.versionId || candidate.version!.versionId === dependency.versionId));
      if (matching.length) {
        if (dependency.type === 'incompatible') add('error', 'PLATFORM_PROJECT_CONFLICT', item.fileId, item.version, dependency);
        continue;
      }
      const projectPresent = dependency.projectId !== null && projects.has(dependency.projectId);
      if (dependency.type === 'required' || dependency.type === 'optional' && projectPresent) {
        add(unresolved ? 'unknown' : 'error', dependency.versionId && projectPresent ? 'PLATFORM_PIN_MISMATCH' : 'PLATFORM_DEPENDENCY_MISSING', item.fileId, item.version, dependency);
      }
    }
  }
  return { state: localState === 'unsatisfied' || issues.some(issue => issue.severity === 'error') ? 'unsatisfied'
    : localState === 'unknown' || issues.some(issue => issue.severity === 'unknown') ? 'unknown' : 'satisfied', files: associations, issues };
}
