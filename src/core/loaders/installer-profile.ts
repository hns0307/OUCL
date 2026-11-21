import type { ClientVersion } from '../version/types.js';
import { identifier, parseArtifact, parseClientVersion, record, requireMetadata } from '../version/validation.js';
import type { InstallerDataValue, InstallerLibrary, InstallerLoaderKind, InstallerProcessor, InstallerProfile } from './types.js';

const FACTS: Record<InstallerLoaderKind, { profile: string; version(minecraft: string, loader: string): string; paths: Readonly<Record<string, string>> }> = {
  forge: { profile: 'forge', version: (minecraft, loader) => `${minecraft}-forge-${loader}`,
    paths: { 'maven.minecraftforge.net': '', 'libraries.minecraft.net': '' } },
  neoforge: { profile: 'NeoForge', version: (_minecraft, loader) => `neoforge-${loader}`,
    paths: { 'maven.neoforged.net': '/releases', 'libraries.minecraft.net': '' } },
};
const REQUIRED_DATA = ['MAPPINGS', 'MOJMAPS', 'MERGED_MAPPINGS', 'BINPATCH', 'MC_SLIM', 'MC_EXTRA', 'MC_SRG', 'PATCHED'] as const;
const BUILTIN_PLACEHOLDERS = new Set(['SIDE', 'MINECRAFT_JAR', 'INSTALLER', 'ROOT']);

function bounded(value: unknown, maximum = 8192): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && [...value].every(character => { const code = character.charCodeAt(0); return code >= 32 && (code < 127 || code > 159); });
}

function mavenPath(coordinate: string): string {
  const pair = coordinate.split('@'); requireMetadata(pair.length <= 2);
  const extension = pair[1] ?? 'jar'; const parts = pair[0]?.split(':') ?? [];
  requireMetadata((parts.length === 3 || parts.length === 4) && /^[\w.-]+$/.test(extension));
  const [group, artifact, version, classifier] = parts;
  requireMetadata(group !== undefined && artifact !== undefined && version !== undefined
    && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(group)
    && [artifact, version, classifier].filter((part): part is string => part !== undefined)
      .every(part => /^[A-Za-z0-9_.+-]+$/.test(part) && part !== '.' && part !== '..'));
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier === undefined ? '' : `-${classifier}`}.${extension}`;
}

function trustedArtifact(value: unknown, coordinate: string, paths: Readonly<Record<string, string>>): InstallerLibrary {
  const artifact = parseArtifact(value); requireMetadata(artifact.path === mavenPath(coordinate));
  let url: URL; try { url = new URL(artifact.url); } catch { requireMetadata(false); }
  const prefix = paths[url.hostname];
  requireMetadata(prefix !== undefined && !url.port && !url.search && !url.hash && url.pathname === `${prefix}/${artifact.path}`);
  return { coordinate, path: artifact.path, url: artifact.url, sha1: artifact.sha1, size: artifact.size };
}

function library(value: unknown, paths: Readonly<Record<string, string>>): InstallerLibrary {
  requireMetadata(record(value) && bounded(value.name, 256) && record(value.downloads));
  return trustedArtifact(value.downloads.artifact, value.name, paths);
}

function dataValue(value: unknown): InstallerDataValue {
  requireMetadata(bounded(value, 512));
  const artifact = /^\[([^\]]+)\]$/.exec(value);
  if (artifact?.[1] !== undefined) return { kind: 'artifact', coordinate: artifact[1], path: mavenPath(artifact[1]) };
  if (/^\/data\/[A-Za-z0-9_.+-]{1,160}$/.test(value)) return { kind: 'embedded', entry: value.slice(1) };
  const literal = /^'([A-Za-z0-9_.+-]{1,160})'$/.exec(value);
  requireMetadata(literal?.[1] !== undefined); return { kind: 'literal', value: literal[1] };
}

function placeholders(value: string): string[] { return [...value.matchAll(/\{([A-Z][A-Z0-9_]{0,63})\}/g)].map(match => match[1]!); }

function processor(value: unknown, libraries: ReadonlySet<string>, allowed: ReadonlySet<string>): InstallerProcessor {
  requireMetadata(record(value) && bounded(value.jar, 256) && libraries.has(value.jar)
    && Array.isArray(value.classpath) && value.classpath.length <= 32
    && value.classpath.every(item => bounded(item, 256) && libraries.has(item))
    && Array.isArray(value.args) && value.args.length <= 128 && value.args.every(item => bounded(item)));
  if (value.sides !== undefined) requireMetadata(Array.isArray(value.sides) && value.sides.length >= 1 && value.sides.length <= 2
    && new Set(value.sides).size === value.sides.length && value.sides.every(side => side === 'client' || side === 'server'));
  const outputs: Record<string, string> = {};
  if (value.outputs !== undefined) {
    requireMetadata(record(value.outputs) && Object.keys(value.outputs).length <= 32);
    for (const [key, digest] of Object.entries(value.outputs)) {
      requireMetadata(/^\{[A-Z][A-Z0-9_]{0,63}\}$/.test(key) && bounded(digest, 160)
        && placeholders(key).every(item => allowed.has(item)) && placeholders(digest).every(item => allowed.has(item)));
      outputs[key] = digest;
    }
  }
  const args = value.args as string[];
  requireMetadata(args.every(argument => placeholders(argument).every(item => allowed.has(item))));
  return { tool: value.jar, classpath: [...value.classpath] as string[], arguments: [...args], outputs };
}

function versionDescriptor(value: unknown, expected: string, minecraft: string, paths: Readonly<Record<string, string>>): ClientVersion {
  const parsed = parseClientVersion(value);
  requireMetadata(parsed.id === expected && parsed.inheritsFrom === minecraft
    && parsed.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher'
    && parsed.downloads === undefined && parsed.assetIndex === undefined && parsed.javaVersion === undefined
    && parsed.minecraftArguments === undefined && parsed.libraries !== undefined);
  const names = new Set<string>(); const artifactPaths = new Set<string>();
  for (const item of parsed.libraries) {
    requireMetadata(item.downloads?.artifact !== undefined && item.downloads.classifiers === undefined
      && item.natives === undefined && item.extract === undefined);
    const artifact = trustedArtifact({ ...item.downloads.artifact, path: item.downloads.artifact.path ?? mavenPath(item.name) }, item.name, paths);
    requireMetadata(!names.has(item.name) && !artifactPaths.has(artifact.path)); names.add(item.name); artifactPaths.add(artifact.path);
  }
  return parsed;
}

/** Parses trusted, already-extracted installer JSON into inert client facts. It never authorizes processor execution. */
export function parseInstallerProfile(kind: InstallerLoaderKind, minecraftVersion: string, loaderVersion: string,
  profileValue: unknown, versionValue: unknown): InstallerProfile {
  requireMetadata((kind === 'forge' || kind === 'neoforge') && identifier(minecraftVersion) && identifier(loaderVersion) && record(profileValue));
  const facts = FACTS[kind]; const expected = facts.version(minecraftVersion, loaderVersion);
  requireMetadata(profileValue.spec === 1 && profileValue.profile === facts.profile && profileValue.version === expected
    && profileValue.minecraft === minecraftVersion && record(profileValue.data)
    && Object.keys(profileValue.data).length <= 64 && Array.isArray(profileValue.libraries) && profileValue.libraries.length <= 256
    && Array.isArray(profileValue.processors) && profileValue.processors.length <= 32);
  const libraries = profileValue.libraries.map(value => library(value, facts.paths));
  const names = new Set(libraries.map(item => item.coordinate));
  requireMetadata(names.size === libraries.length && new Set(libraries.map(item => item.path)).size === libraries.length);
  const data: Record<string, InstallerDataValue> = {};
  for (const [key, raw] of Object.entries(profileValue.data)) {
    requireMetadata(/^[A-Z][A-Z0-9_]{0,63}$/.test(key) && record(raw) && raw.client !== undefined);
    data[key] = dataValue(raw.client);
  }
  requireMetadata(REQUIRED_DATA.every(key => data[key] !== undefined));
  const allowed = new Set([...Object.keys(data), ...BUILTIN_PLACEHOLDERS]);
  const processors = profileValue.processors.flatMap(value => {
    requireMetadata(record(value));
    if (Array.isArray(value.sides) && !value.sides.includes('client')) return [];
    return [processor(value, names, allowed)];
  });
  requireMetadata(processors.length >= 1);
  return { kind, minecraftVersion, loaderVersion, version: versionDescriptor(versionValue, expected, minecraftVersion, facts.paths),
    libraries, data, processors };
}
