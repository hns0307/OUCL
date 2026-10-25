import { artifactProofKey, planVanillaInstall } from '../../core/install/plan.js';
import type { AssetIndexContent } from '../../core/install/assets.js';
import { resolveClientVersion } from '../../core/version/resolve.js';
import type { ClientVersion, VersionEnvironment } from '../../core/version/types.js';
import type { LoaderProfile } from '../../core/loaders/types.js';
import type { LoaderLibraryPlan } from './maven.js';

export interface LoaderCompositionInput {
  baseVersionDocuments: Readonly<Record<string, string>>;
  baseMetadataSha1ByVersion: Readonly<Record<string, string>>;
  assets: AssetIndexContent;
  profile: LoaderProfile;
  profileSha256: string;
  libraries: LoaderLibraryPlan;
  environment: VersionEnvironment;
}

/** Composes a loader descriptor over verified vanilla documents and rebuilds the complete install plan. */
export function composeLoaderInstall(input: LoaderCompositionInput) {
  if (!Object.hasOwn(input.baseVersionDocuments, input.profile.minecraftVersion)) throw new Error('INVALID_LOADER_BASE');
  if (!/^[a-f0-9]{64}$/.test(input.profileSha256) || input.libraries.libraries.length !== input.profile.libraries.length) throw new Error('INVALID_LOADER_PROOF');
  const downloads = new Map(input.libraries.libraries.map(item => [item.path, item.spec]));
  const artifactProofs: Record<string, Array<{ kind: 'loader-profile' | 'loader-maven'; algorithm: 'sha256'; digest: string }>> = {};
  const descriptor: ClientVersion = {
    id: input.profile.id,
    inheritsFrom: input.profile.minecraftVersion,
    mainClass: input.profile.mainClass,
    arguments: input.profile.arguments,
    libraries: input.profile.libraries.map(library => {
      const selected = downloads.get(library.path);
      if (!selected || selected.url !== library.url || selected.expected.algorithm !== 'sha1'
        || (selected.anchor.kind !== 'loader-profile' && selected.anchor.kind !== 'loader-maven') || selected.anchor.algorithm !== 'sha256') throw new Error('INVALID_LOADER_LIBRARY');
      const artifact = { url: selected.url, sha1: selected.expected.digest, size: selected.expected.size, path: library.path };
      const key = artifactProofKey(artifact); const proof = { kind: selected.anchor.kind, algorithm: 'sha256' as const, digest: selected.anchor.digest };
      const entries = artifactProofs[key] ??= [];
      if (!entries.some(entry => entry.kind === proof.kind && entry.digest === proof.digest)) entries.push(proof);
      return { name: library.coordinate, downloads: { artifact }, ...(library.rules === undefined ? {} : { rules: library.rules }) };
    })
  };
  const documents: Record<string, unknown> = Object.fromEntries(Object.entries(input.baseVersionDocuments).map(([id, body]) => {
    try { return [id, JSON.parse(body) as unknown]; } catch { throw new Error('INVALID_LOADER_BASE'); }
  }));
  if (Object.hasOwn(documents, descriptor.id)) throw new Error('INVALID_LOADER_BASE');
  documents[descriptor.id] = descriptor;
  const version = resolveClientVersion(descriptor.id, documents, input.environment);
  const proof = { ...input.baseMetadataSha1ByVersion,
    [descriptor.id]: { kind: 'loader-profile' as const, algorithm: 'sha256' as const, digest: input.profileSha256 } };
  return { version, plan: planVanillaInstall(version, proof, input.assets, artifactProofs), loaderDocument: JSON.stringify(descriptor), metadataProofByVersion: proof };
}
