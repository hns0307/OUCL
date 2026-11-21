import type { Rule, VersionArgument } from '../version/types.js';
import { identifier, parseClientVersion, record, requireMetadata, VersionError } from '../version/validation.js';
import type { LoaderArtifact, LoaderProfile, LoaderVersionSummary } from './types.js';
import type { InstallerLoaderKind } from './types.js';

type ProfileKind = LoaderProfile['kind'];

const PROFILE_FACTS: Record<ProfileKind, { idPrefix: string; mainClass: string; origins: ReadonlySet<string> }> = {
  fabric: {
    idPrefix: 'fabric-loader-',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    origins: new Set(['https://maven.fabricmc.net'])
  },
  quilt: {
    idPrefix: 'quilt-loader-',
    mainClass: 'org.quiltmc.loader.impl.launch.knot.KnotClient',
    origins: new Set(['https://maven.fabricmc.net', 'https://maven.quiltmc.org'])
  }
};

function boundedText(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value;
}

function catalogCoordinate(value: unknown): string {
  requireMetadata(boundedText(value) && /^[\w.-]+:[\w.-]+:[\w.+-]+$/.test(value));
  return value;
}

function catalogPart(value: unknown): Record<string, unknown> {
  requireMetadata(record(value) && catalogCoordinate(value.maven) && boundedText(value.version, 160));
  return value;
}

/** Parses official Fabric/Quilt catalog responses without selecting or guessing a version. */
export function parseLoaderCatalog(
  kind: ProfileKind,
  minecraftVersion: string,
  value: unknown
): LoaderVersionSummary[] {
  requireMetadata(identifier(minecraftVersion) && Array.isArray(value) && value.length <= 2048);
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    requireMetadata(record(entry));
    const loader = catalogPart(entry.loader);
    const intermediary = catalogPart(entry.intermediary);
    if (kind === 'fabric') requireMetadata(typeof loader.stable === 'boolean');
    else requireMetadata(loader.stable === undefined || typeof loader.stable === 'boolean');
    requireMetadata(intermediary.version === minecraftVersion && !seen.has(loader.version as string));
    seen.add(loader.version as string);
    return {
      kind,
      minecraftVersion,
      loaderVersion: loader.version as string,
      loaderCoordinate: loader.maven as string,
      intermediaryCoordinate: intermediary.maven as string,
      stable: kind === 'fabric' ? loader.stable as boolean
        : (loader.stable as boolean | undefined) ?? !/(?:^|[.+-])(alpha|beta|rc|snapshot)(?:[.+-]|$)/i.test(loader.version as string)
    };
  });
}

function numericDescending(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (b[index] ?? -1) - (a[index] ?? -1); if (difference !== 0) return difference;
  }
  return left < right ? 1 : left > right ? -1 : 0;
}

/** Parses the fixed official Forge promotions or NeoForge Maven release catalog without claiming compatibility. */
export function parseInstallerCatalog(kind: InstallerLoaderKind, minecraftVersion: string, value: unknown): LoaderVersionSummary[] {
  requireMetadata((kind === 'forge' || kind === 'neoforge') && identifier(minecraftVersion) && record(value));
  if (kind === 'forge') {
    requireMetadata(record(value.promos) && Object.keys(value.promos).length <= 4096);
    const recommended = value.promos[`${minecraftVersion}-recommended`]; const latest = value.promos[`${minecraftVersion}-latest`];
    requireMetadata((recommended === undefined || boundedText(recommended, 160)) && (latest === undefined || boundedText(latest, 160)));
    const versions = [...new Set([recommended, latest].filter((item): item is string => typeof item === 'string'))];
    requireMetadata(versions.length >= 1 && versions.every(identifier));
    return versions.map(loaderVersion => ({ kind, minecraftVersion, loaderVersion, stable: loaderVersion === recommended }));
  }
  requireMetadata(minecraftVersion === '1.21.1' && value.isSnapshot === false && Array.isArray(value.versions) && value.versions.length <= 4096);
  const versions = value.versions.filter((item: unknown): item is string => typeof item === 'string' && /^21\.1\.\d+$/.test(item));
  requireMetadata(versions.length >= 1 && versions.length <= 512 && new Set(versions).size === versions.length);
  return versions.sort(numericDescending).map(loaderVersion => ({ kind, minecraftVersion, loaderVersion, stable: true }));
}

function coordinatePath(coordinate: string): string {
  const [withoutExtension, extension = 'jar'] = coordinate.split('@');
  requireMetadata(withoutExtension !== undefined && /^[\w.-]+$/.test(extension));
  const parts = withoutExtension.split(':');
  requireMetadata(parts.length === 3 || parts.length === 4);
  const [group, artifact, version, classifier] = parts;
  requireMetadata(group !== undefined && artifact !== undefined && version !== undefined
    && [group, artifact, version, classifier].filter((part): part is string => part !== undefined)
      .every(part => /^[\w.+-]+$/.test(part)));
  const suffix = classifier === undefined ? '' : `-${classifier}`;
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${suffix}.${extension}`;
}

function parseLibrary(kind: ProfileKind, value: unknown, rules: Rule[] | undefined): LoaderArtifact {
  requireMetadata(record(value) && boundedText(value.name));
  const path = coordinatePath(value.name);
  requireMetadata(typeof value.url === 'string' && value.url.length <= 2048);
  let base: URL;
  try { base = new URL(value.url); } catch { throw new VersionError('INVALID_METADATA'); }
  requireMetadata(base.protocol === 'https:' && !base.username && !base.password
    && !base.search && !base.hash && PROFILE_FACTS[kind].origins.has(base.origin));
  const baseUrl = base.href.endsWith('/') ? base.href : `${base.href}/`;
  const result: LoaderArtifact = {
    coordinate: value.name,
    path,
    url: new URL(path, baseUrl).href,
    proof: 'official-sidecar-required'
  };
  if (rules !== undefined) result.rules = rules;
  const hasSha1 = value.sha1 !== undefined;
  const hasSize = value.size !== undefined;
  requireMetadata(hasSha1 === hasSize);
  if (hasSha1) {
    requireMetadata(typeof value.sha1 === 'string' && /^[a-fA-F0-9]{40}$/.test(value.sha1)
      && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0);
    result.sha1 = value.sha1.toLowerCase();
    result.size = value.size;
    result.proof = 'inline-sha1';
  }
  return result;
}

/** Converts a trusted official launcher profile into bounded, non-executable facts. */
export function parseLoaderProfile(
  kind: ProfileKind,
  minecraftVersion: string,
  loaderVersion: string,
  value: unknown
): LoaderProfile {
  requireMetadata(identifier(minecraftVersion) && identifier(loaderVersion) && record(value));
  const client = parseClientVersion(value);
  const facts = PROFILE_FACTS[kind];
  requireMetadata(client.id === `${facts.idPrefix}${loaderVersion}-${minecraftVersion}`
    && client.inheritsFrom === minecraftVersion && client.mainClass === facts.mainClass
    && client.minecraftArguments === undefined && client.downloads === undefined
    && client.assetIndex === undefined && client.javaVersion === undefined
    && Array.isArray(value.libraries) && value.libraries.length <= 256);
  const game: VersionArgument[] = client.arguments?.game ?? [];
  const jvm: VersionArgument[] = client.arguments?.jvm ?? [];
  const libraries = value.libraries.map((entry, index) => {
    const parsed = client.libraries?.[index];
    requireMetadata(parsed !== undefined && parsed.name === (record(entry) ? entry.name : undefined)
      && parsed.downloads === undefined && parsed.natives === undefined && parsed.extract === undefined);
    return parseLibrary(kind, entry, parsed.rules);
  });
  requireMetadata(new Set(libraries.map(library => library.coordinate)).size === libraries.length
    && new Set(libraries.map(library => library.path)).size === libraries.length);
  return {
    kind,
    minecraftVersion,
    loaderVersion,
    id: client.id,
    mainClass: client.mainClass,
    arguments: { game, jvm },
    libraries
  };
}
