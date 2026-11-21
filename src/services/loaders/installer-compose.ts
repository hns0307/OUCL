import { enforceInstallerProcessorPolicy } from '../../core/loaders/processor-policy.js';
import { parseInstallerProfile } from '../../core/loaders/installer-profile.js';
import type { InstallerProfile } from '../../core/loaders/types.js';
import type { AssetIndexContent } from '../../core/install/assets.js';
import { artifactProofKey, planVanillaInstall } from '../../core/install/plan.js';
import type { PlannedArtifact, PlannedSource, VanillaInstallPlan } from '../../core/install/plan.js';
import { resolveClientVersion } from '../../core/version/resolve.js';
import type { VersionEnvironment } from '../../core/version/types.js';
import { createHash } from 'node:crypto';

export interface InstallerCompositionInput {
  baseVersionDocuments: Readonly<Record<string, string>>; baseMetadataSha1ByVersion: Readonly<Record<string, string>>;
  assets: AssetIndexContent; profile: InstallerProfile; profileSha256: string; environment: VersionEnvironment;
}

/** Revalidates both exact installer documents before any resume path rebuilds their projection. */
export function parseStoredInstallerProfile(kind: InstallerProfile['kind'], minecraftVersion: string, loaderVersion: string,
  profileBody: string, profileSha256: string, versionBody: string, versionSha256: string): InstallerProfile {
  if (typeof profileBody !== 'string' || Buffer.byteLength(profileBody) > 2 * 1024 ** 2 || !/^[a-f0-9]{64}$/.test(profileSha256)
    || createHash('sha256').update(profileBody).digest('hex') !== profileSha256
    || typeof versionBody !== 'string' || Buffer.byteLength(versionBody) > 2 * 1024 ** 2 || !/^[a-f0-9]{64}$/.test(versionSha256)
    || createHash('sha256').update(versionBody).digest('hex') !== versionSha256) throw new Error('INVALID_INSTALLER_PROFILE');
  try { return parseInstallerProfile(kind, minecraftVersion, loaderVersion, JSON.parse(profileBody) as unknown, JSON.parse(versionBody) as unknown); }
  catch { throw new Error('INVALID_INSTALLER_PROFILE'); }
}

function addProcessorLibraries(plan: VanillaInstallPlan, profile: InstallerProfile, source: PlannedSource): VanillaInstallPlan {
  const artifacts = new Map(plan.artifacts.map(item => [item.artifactId, { ...item, proofs: [...item.proofs], alternateUrls: [...item.alternateUrls] }]));
  const views = new Map(plan.views.map(item => [`${item.area}:${item.path.toLowerCase()}`, { ...item }])); let totalBytes = plan.totalBytes;
  for (const library of profile.libraries) {
    const artifactId = `sha1-${library.sha1}`; const proof = { source, provenanceId: `loader:${source.digest}:${library.sha1}` };
    const existing = artifacts.get(artifactId);
    if (existing) {
      if (existing.size !== library.size) throw new Error('INSTALLER_LIBRARY_CONFLICT');
      if (existing.url !== library.url && !existing.alternateUrls.includes(library.url)) existing.alternateUrls.push(library.url);
      if (!existing.proofs.some(item => item.provenanceId === proof.provenanceId)) existing.proofs.push(proof);
    } else {
      const artifact: PlannedArtifact = { artifactId, url: library.url, sha1: library.sha1, size: library.size,
        ...proof, proofs: [proof], alternateUrls: [] };
      artifacts.set(artifactId, artifact); totalBytes += library.size;
      if (!Number.isSafeInteger(totalBytes)) throw new Error('INSTALLER_LIBRARY_LIMIT');
    }
    const key = `libraries:${library.path.toLowerCase()}`; const old = views.get(key);
    if (old && old.artifactId !== artifactId || old && old.path !== library.path) throw new Error('INSTALLER_LIBRARY_CONFLICT');
    views.set(key, { area: 'libraries', path: library.path, artifactId });
  }
  return { ...plan, artifacts: [...artifacts.values()], views: [...views.values()], totalBytes };
}

/** Composes authenticated installer metadata while keeping processor-only libraries out of the launch classpath. */
export function composeInstallerInstall(input: InstallerCompositionInput) {
  enforceInstallerProcessorPolicy(input.profile);
  if (!Object.hasOwn(input.baseVersionDocuments, input.profile.minecraftVersion) || !/^[a-f0-9]{64}$/.test(input.profileSha256)) {
    throw new Error('INVALID_INSTALLER_BASE');
  }
  const documents: Record<string, unknown> = Object.fromEntries(Object.entries(input.baseVersionDocuments).map(([id, body]) => {
    try { return [id, JSON.parse(body) as unknown]; } catch { throw new Error('INVALID_INSTALLER_BASE'); }
  }));
  if (Object.hasOwn(documents, input.profile.version.id)) throw new Error('INVALID_INSTALLER_BASE');
  documents[input.profile.version.id] = input.profile.version;
  const source = { kind: 'loader-profile' as const, algorithm: 'sha256' as const, digest: input.profileSha256 };
  const proof = { ...input.baseMetadataSha1ByVersion, [input.profile.version.id]: source };
  const version = resolveClientVersion(input.profile.version.id, documents, input.environment);
  const artifactProofs: Record<string, PlannedSource[]> = {};
  for (const library of input.profile.libraries) artifactProofs[artifactProofKey({ url: library.url, sha1: library.sha1 })] = [source];
  const plan = addProcessorLibraries(planVanillaInstall(version, proof, input.assets, artifactProofs), input.profile, source);
  return { version, plan, loaderDocument: JSON.stringify(input.profile.version), metadataProofByVersion: proof };
}
