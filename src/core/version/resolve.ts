import type { ClientVersion, ResolvedClientVersion, ResolvedLibrary, VersionEnvironment, VersionLibrary } from './types.js';
import { identifier, parseClientVersion, requireMetadata, VersionError } from './validation.js';
import { rulesAllow, selectArguments, tokenizeLegacyArguments } from './arguments.js';

/** Maven versions override by group/artifact/classifier/extension, never basename. */
function libraryIdentity(name: string): string {
  const [coordinate = '', extension = 'jar'] = name.split('@');
  const [group = '', artifact = '', , classifier = ''] = coordinate.split(':');
  return `${group}:${artifact}:${classifier}@${extension}`;
}

/** Resolves one selected descriptor from verified inputs; performs no IO or hashing. */
export function resolveClientVersion(targetId: string, documents: Readonly<Record<string, unknown>>, environment: VersionEnvironment): ResolvedClientVersion {
  requireMetadata(identifier(targetId));
  const chain: ClientVersion[] = []; const seen = new Set<string>();
  let next: string | undefined = targetId;
  while (next !== undefined) {
    if (seen.has(next)) throw new VersionError('CIRCULAR_INHERITANCE');
    if (chain.length >= 32) throw new VersionError('INHERITANCE_LIMIT');
    if (!Object.hasOwn(documents, next)) throw new VersionError('MISSING_PARENT');
    const version = parseClientVersion(documents[next]); requireMetadata(version.id === next);
    seen.add(next); chain.push(version); next = version.inheritsFrom;
  }
  chain.reverse();
  let mainClass: string | undefined; let type = 'release'; let javaMajor = 8;
  let client: ResolvedClientVersion['client'] | undefined; let jarVersionId = '';
  let assetIndex: ResolvedClientVersion['assetIndex']; let assets: string | undefined;
  const libraries = new Map<string, VersionLibrary>(); let gameArguments: string[] = []; const jvmArguments: string[] = [];
  for (const version of chain) {
    if (version.mainClass !== undefined) mainClass = version.mainClass;
    if (version.type !== undefined) type = version.type;
    if (version.javaVersion !== undefined) javaMajor = version.javaVersion.majorVersion;
    if (version.downloads?.client) { client = version.downloads.client; jarVersionId = version.id; }
    if (version.assetIndex) assetIndex = version.assetIndex;
    if (version.assets !== undefined) assets = version.assets;
    for (const library of version.libraries ?? []) libraries.set(libraryIdentity(library.name), library);
    requireMetadata(libraries.size <= 10000);
    if (version.minecraftArguments !== undefined) gameArguments = tokenizeLegacyArguments(version.minecraftArguments);
    gameArguments.push(...selectArguments(version.arguments?.game ?? [], environment));
    jvmArguments.push(...selectArguments(version.arguments?.jvm ?? [], environment));
    requireMetadata(gameArguments.length <= 4096 && jvmArguments.length <= 4096);
  }
  if (!client) throw new VersionError('CLIENT_NOT_FOUND');
  if (!mainClass) throw new VersionError('MAIN_CLASS_MISSING');
  const selected: ResolvedLibrary[] = [];
  for (const library of libraries.values()) {
    if (!rulesAllow(library.rules, environment)) continue;
    const resolved: ResolvedLibrary = { name: library.name, nativeExcludes: [...(library.extract?.exclude ?? [])] };
    if (library.downloads?.artifact) resolved.artifact = library.downloads.artifact;
    const nativeTemplate = library.natives?.[environment.os];
    if (nativeTemplate !== undefined) {
      const classifier = nativeTemplate.replace(/\$\{arch\}/g, environment.arch === 'x86' ? '32' : '64');
      const native = library.downloads?.classifiers?.[classifier];
      if (!native || classifier.includes('${')) throw new VersionError('NATIVE_NOT_FOUND');
      resolved.native = native; resolved.nativeClassifier = classifier;
    }
    selected.push(resolved);
  }
  const result: ResolvedClientVersion = { id: targetId, ancestry: chain.map(version => version.id), mainClass, type, javaMajor,
    client, jarVersionId, libraries: selected, gameArguments, jvmArguments };
  if (assetIndex !== undefined) result.assetIndex = assetIndex;
  if (assets !== undefined) result.assets = assets;
  return result;
}
