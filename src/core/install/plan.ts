import { validateComponent } from '../path/layout.js';
import { parseArtifact } from '../version/validation.js';
import type { DownloadArtifact, ResolvedClientVersion } from '../version/types.js';
import { InstallPlanError, installRelativePath } from './assets.js';
import type { AssetIndexContent } from './assets.js';

export interface PlannedSource {
  kind: 'mojang-version' | 'mojang-assets' | 'loader-profile' | 'loader-maven';
  algorithm: 'sha1' | 'sha256';
  digest: string;
}
export interface ArtifactProof { source: PlannedSource; provenanceId: string }
export interface PlannedArtifact extends ArtifactProof {
  artifactId: string; url: string; sha1: string; size: number;
  proofs: ArtifactProof[]; alternateUrls: string[];
}
export interface InstallView { area: 'assets' | 'libraries' | 'version' | 'resources'; path: string; artifactId: string }
export interface NativeArchive { artifactId: string; archivePath: string; exclude: string[] }
export interface VanillaInstallPlan {
  artifacts: PlannedArtifact[]; views: InstallView[]; natives: NativeArchive[]; classpath: string[]; totalBytes: number;
}
export function artifactProofKey(value: Pick<DownloadArtifact, 'url' | 'sha1'>): string { return `${value.sha1.toLowerCase()}\n${value.url}`; }

function component(value: string): string {
  try { return validateComponent(value); } catch { throw new InstallPlanError('INVALID_INSTALL_PATH'); }
}
function coordinate(name: string, overrideClassifier?: string): { path: string; classifier: string } {
  if (!/^[\w.-]+:[\w.-]+:[\w.+-]+(?::[\w.+-]+)?(?:@[\w.-]+)?$/.test(name) || name.length > 256) throw new InstallPlanError('INVALID_LIBRARY');
  const [body = '', extension = 'jar'] = name.split('@');
  const [group = '', artifact = '', version = '', classifier = ''] = body.split(':');
  const selected = overrideClassifier ?? classifier;
  const directories = group.split('.').map(component).join('/');
  const file = `${artifact}-${version}${selected ? '-' + component(selected) : ''}.${component(extension)}`;
  return { path: installRelativePath(`${directories}/${component(artifact)}/${component(version)}/${component(file)}`), classifier };
}
function exclusions(values: readonly string[]): string[] {
  if (values.length > 64) throw new InstallPlanError('INSTALL_LIMIT');
  return [...new Set(['META-INF/', ...values].map(value => {
    installRelativePath(value.endsWith('/') ? value.slice(0, -1) : value); return value;
  }))].sort();
}
function windowsX64Native(classifier: string): boolean {
  return ['natives-windows', 'natives-windows-x64', 'natives-windows-x86_64', 'natives-windows-64'].includes(classifier);
}

/** Builds trusted vanilla download/view/extraction facts only; no IO, URLs are never executable commands. */
export function planVanillaInstall(version: ResolvedClientVersion,
  metadataProofByVersion: Readonly<Record<string, string | PlannedSource>>, assets: AssetIndexContent,
  artifactProofs: Readonly<Record<string, readonly PlannedSource[]>> = {}): VanillaInstallPlan {
  if (!version.assetIndex) throw new InstallPlanError('ASSET_INDEX_REQUIRED');
  if (version.libraries.length > 10000 || assets.objects.length > 100000) throw new InstallPlanError('INSTALL_LIMIT');
  const artifacts = new Map<string, PlannedArtifact>(); const addresses = new Map<string, string>();
  const views = new Map<string, InstallView>(); const directories = new Set<string>();
  const natives = new Map<string, NativeArchive>(); const classpath = new Set<string>();
  let totalBytes = 0;
  const canonicalSource = (raw: string | PlannedSource | undefined): PlannedSource => {
    if (typeof raw === 'string') {
      if (!/^[a-fA-F0-9]{40}$/.test(raw)) throw new InstallPlanError('MISSING_METADATA_PROOF');
      return { kind: 'mojang-version', algorithm: 'sha1', digest: raw.toLowerCase() };
    }
    if (!raw || !['mojang-version', 'mojang-assets', 'loader-profile', 'loader-maven'].includes(raw.kind)
      || !['sha1', 'sha256'].includes(raw.algorithm) || !new RegExp(`^[a-fA-F0-9]{${raw.algorithm === 'sha1' ? 40 : 64}}$`).test(raw.digest)) {
      throw new InstallPlanError('MISSING_METADATA_PROOF');
    }
    return { kind: raw.kind, algorithm: raw.algorithm, digest: raw.digest.toLowerCase() };
  };
  const sources = (id: string | undefined, value: DownloadArtifact): PlannedSource[] => {
    const overrides = artifactProofs[artifactProofKey(value)];
    if (overrides !== undefined) {
      if (overrides.length < 1 || overrides.length > 16) throw new InstallPlanError('MISSING_METADATA_PROOF');
      return overrides.map(canonicalSource);
    }
    if (id === undefined || !version.ancestry.includes(id) || !Object.hasOwn(metadataProofByVersion, id)) throw new InstallPlanError('MISSING_METADATA_PROOF');
    return [canonicalSource(metadataProofByVersion[id])];
  };
  const artifact = (raw: DownloadArtifact, origins: readonly PlannedSource[]): string => {
    let value: DownloadArtifact;
    try { value = parseArtifact(raw); } catch { throw new InstallPlanError('INVALID_ARTIFACT'); }
    if (value.size > 64 * 1024 ** 3) throw new InstallPlanError('INSTALL_LIMIT');
    const artifactId = `sha1-${value.sha1}`;
    const proofs = origins.map(origin => ({ source: origin,
      provenanceId: `${origin.kind === 'mojang-assets' ? 'asset' : origin.kind.startsWith('loader-') ? 'loader' : 'version'}:${origin.digest}:${value.sha1}` }));
    const proof = proofs[0]; if (!proof) throw new InstallPlanError('MISSING_METADATA_PROOF');
    const existing = artifacts.get(artifactId); const atAddress = addresses.get(value.url);
    if (atAddress !== undefined && atAddress !== artifactId || existing && existing.size !== value.size) throw new InstallPlanError('ARTIFACT_CONFLICT');
    addresses.set(value.url, artifactId);
    if (existing) {
      if (existing.url !== value.url && !existing.alternateUrls.includes(value.url)) existing.alternateUrls.push(value.url);
      for (const candidate of proofs) if (!existing.proofs.some(entry => entry.provenanceId === candidate.provenanceId)) existing.proofs.push(candidate);
    } else {
      artifacts.set(artifactId, { artifactId, url: value.url, sha1: value.sha1, size: value.size, ...proof, proofs, alternateUrls: [] });
      totalBytes += value.size;
      if (!Number.isSafeInteger(totalBytes)) throw new InstallPlanError('INSTALL_LIMIT');
    }
    return artifactId;
  };
  const view = (area: InstallView['area'], path: string, artifactId: string): string => {
    const name = installRelativePath(path); const key = `${area}:${name.toLowerCase()}`; const previous = views.get(key);
    if (previous) {
      if (previous.artifactId !== artifactId || previous.path !== name) throw new InstallPlanError('VIEW_CONFLICT');
      return previous.path;
    }
    if (directories.has(key)) throw new InstallPlanError('VIEW_CONFLICT');
    const parts = name.toLowerCase().split('/'); parts.pop();
    while (parts.length) {
      const prefix = `${area}:${parts.join('/')}`;
      if (views.has(prefix)) throw new InstallPlanError('VIEW_CONFLICT');
      directories.add(prefix); parts.pop();
    }
    views.set(key, { area, path: name, artifactId }); return name;
  };
  const native = (artifactId: string, archivePath: string, exclude: readonly string[]): void => {
    const entry = { artifactId, archivePath, exclude: exclusions(exclude) }; const previous = natives.get(archivePath);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new InstallPlanError('ARTIFACT_CONFLICT');
    natives.set(archivePath, entry);
  };
  view('version', 'client.jar', artifact(version.client, sources(version.jarVersionId, version.client)));
  const assetIndexId = component(version.assetIndex.id);
  view('assets', `indexes/${assetIndexId}.json`, artifact(version.assetIndex, sources(version.assetIndexVersionId, version.assetIndex)));
  for (const library of version.libraries) {
    const identity = coordinate(library.name);
    if (library.artifact) {
      const id = artifact(library.artifact, sources(library.sourceVersionId, library.artifact));
      const path = view('libraries', library.artifact.path ?? identity.path, id); classpath.add(path);
      // Modern descriptors also list x86/ARM64 Windows JARs. Preserve the upstream classpath,
      // but never extract incompatible DLLs into this first release's private x64 native directory.
      if (windowsX64Native(identity.classifier)) native(id, path, library.nativeExcludes);
    }
    if (library.native) {
      if (!library.nativeClassifier) throw new InstallPlanError('INVALID_LIBRARY');
      const path = library.native.path ?? coordinate(library.name, library.nativeClassifier).path;
      const id = artifact(library.native, sources(library.sourceVersionId, library.native)); view('libraries', path, id); native(id, path, library.nativeExcludes);
    }
    if (!library.artifact && !library.native) throw new InstallPlanError('INVALID_LIBRARY');
  }
  for (const object of assets.objects) {
    const id = artifact({ url: `https://resources.download.minecraft.net/${object.sha1.slice(0, 2)}/${object.sha1}`, sha1: object.sha1, size: object.size },
      [{ kind: 'mojang-assets', algorithm: 'sha1', digest: version.assetIndex.sha1.toLowerCase() }]);
    view('assets', `objects/${object.sha1.slice(0, 2)}/${object.sha1}`, id);
    if (assets.virtual) view('assets', `virtual/${assetIndexId}/${object.name}`, id);
    if (assets.mapToResources) view('resources', object.name, id);
  }
  return { artifacts: [...artifacts.values()], views: [...views.values()], natives: [...natives.values()], classpath: [...classpath], totalBytes };
}
