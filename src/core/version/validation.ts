import type { ClientVersion, DownloadArtifact, Rule, VersionArgument, VersionLibrary } from './types.js';

export type VersionErrorCode = 'INVALID_METADATA' | 'MISSING_PARENT' | 'CIRCULAR_INHERITANCE' | 'INHERITANCE_LIMIT'
  | 'CLIENT_NOT_FOUND' | 'MAIN_CLASS_MISSING' | 'INVALID_RULE_PATTERN' | 'NATIVE_NOT_FOUND'
  | 'INVALID_LEGACY_ARGUMENTS' | 'UNKNOWN_PLACEHOLDER';

/** Represents a bounded validation error without retaining source JSON or secrets. */
export class VersionError extends Error {
  readonly category = 'validation';
  constructor(readonly code: VersionErrorCode) { super(code); this.name = 'VersionError'; }
}

/** Asserts an untrusted metadata field, returning a fixed redacted error on failure. */
export function requireMetadata(condition: unknown): asserts condition {
  if (!condition) throw new VersionError('INVALID_METADATA');
}

/** Accepts an upstream object; unknown metadata fields are ignored, never executed. */
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Restricts upstream identifiers to bounded safe names, not arbitrary paths. */
export function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 160
    && /^[a-zA-Z0-9_.+-]+$/.test(value) && !['.', '..'].includes(value);
}

/** Validates official artifact facts; callers must still establish metadata trust. */
export function parseArtifact(value: unknown): DownloadArtifact {
  requireMetadata(record(value) && typeof value.url === 'string' && value.url.length <= 2048
    && typeof value.sha1 === 'string' && /^[a-fA-F0-9]{40}$/.test(value.sha1)
    && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0);
  let url: URL;
  try { url = new URL(value.url); } catch { throw new VersionError('INVALID_METADATA'); }
  requireMetadata(url.protocol === 'https:' && !url.username && !url.password);
  const result: DownloadArtifact = { url: url.href, sha1: value.sha1.toLowerCase(), size: value.size };
  if (value.path !== undefined) {
    requireMetadata(typeof value.path === 'string' && value.path.length <= 1024
      && !/[\\:]/.test(value.path) && !value.path.includes(String.fromCharCode(0))
      && value.path.split('/').every(part => part.length > 0 && !['.', '..'].includes(part)));
    result.path = value.path;
  }
  return result;
}

/** Reads ordered allow/disallow rules, including explicit false feature conditions. */
export function parseRules(value: unknown): Rule[] {
  requireMetadata(Array.isArray(value) && value.length <= 64);
  return value.map((entry: unknown) => {
    requireMetadata(record(entry) && (entry.action === 'allow' || entry.action === 'disallow'));
    const result: Rule = { action: entry.action };
    if (entry.os !== undefined) {
      requireMetadata(record(entry.os));
      result.os = {};
      for (const key of ['name', 'arch', 'version'] as const) {
        const field = entry.os[key];
        if (field !== undefined) { requireMetadata(typeof field === 'string' && field.length <= 128); result.os[key] = field; }
      }
    }
    if (entry.features !== undefined) {
      requireMetadata(record(entry.features) && Object.keys(entry.features).length <= 64);
      result.features = {};
      for (const [key, flag] of Object.entries(entry.features)) {
        requireMetadata(/^[a-zA-Z0-9_]{1,80}$/.test(key) && typeof flag === 'boolean');
        Object.defineProperty(result.features, key, { value: flag, enumerable: true });
      }
    }
    return result;
  });
}

/** Validates a bounded modern argument list without substituting runtime values. */
function parseArguments(value: unknown): VersionArgument[] {
  requireMetadata(Array.isArray(value) && value.length <= 4096);
  return value.map((entry: unknown) => {
    if (typeof entry === 'string') { requireMetadata(entry.length <= 8192); return entry; }
    requireMetadata(record(entry));
    const rules = parseRules(entry.rules);
    const raw: unknown[] = Array.isArray(entry.value) ? entry.value : [entry.value];
    requireMetadata(raw.length <= 64 && raw.every((item: unknown) => typeof item === 'string' && item.length <= 8192));
    return { rules, value: raw as string[] };
  });
}

/** Validates a Maven library, preserving native classifier facts and exclusions. */
function parseLibrary(value: unknown): VersionLibrary {
  requireMetadata(record(value) && typeof value.name === 'string' && value.name.length <= 256
    && /^[\w.-]+:[\w.-]+:[\w.+-]+(?::[\w.+-]+)?(?:@[\w.-]+)?$/.test(value.name));
  const result: VersionLibrary = { name: value.name };
  if (value.rules !== undefined) result.rules = parseRules(value.rules);
  if (value.downloads !== undefined) {
    requireMetadata(record(value.downloads)); result.downloads = {};
    if (value.downloads.artifact !== undefined) result.downloads.artifact = parseArtifact(value.downloads.artifact);
    if (value.downloads.classifiers !== undefined) {
      requireMetadata(record(value.downloads.classifiers) && Object.keys(value.downloads.classifiers).length <= 64);
      result.downloads.classifiers = {};
      for (const [key, artifact] of Object.entries(value.downloads.classifiers)) {
        requireMetadata(identifier(key)); result.downloads.classifiers[key] = parseArtifact(artifact);
      }
    }
  }
  if (value.natives !== undefined) {
    requireMetadata(record(value.natives)); result.natives = {};
    for (const [os, classifier] of Object.entries(value.natives)) {
      requireMetadata(['windows', 'linux', 'osx'].includes(os) && typeof classifier === 'string' && /^[\w${}.-]{1,160}$/.test(classifier));
      result.natives[os] = classifier;
    }
  }
  if (value.extract !== undefined) {
    requireMetadata(record(value.extract) && Array.isArray(value.extract.exclude) && value.extract.exclude.length <= 64
      && value.extract.exclude.every((item: unknown) => typeof item === 'string' && item.length <= 512));
    result.extract = { exclude: [...value.extract.exclude] as string[] };
  }
  return result;
}

/** Converts an independently supplied upstream client descriptor to typed facts. */
export function parseClientVersion(value: unknown): ClientVersion {
  requireMetadata(record(value) && identifier(value.id));
  const result: ClientVersion = { id: value.id };
  if (value.inheritsFrom !== undefined) { requireMetadata(identifier(value.inheritsFrom)); result.inheritsFrom = value.inheritsFrom; }
  for (const key of ['mainClass', 'type', 'assets', 'minecraftArguments'] as const) {
    const field = value[key];
    if (field !== undefined) { requireMetadata(typeof field === 'string' && field.length > 0 && field.length <= 32768); result[key] = field; }
  }
  if (result.mainClass !== undefined) requireMetadata(result.mainClass.length <= 256 && /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/.test(result.mainClass));
  if (result.type !== undefined) requireMetadata(result.type.length <= 64);
  if (result.assets !== undefined) requireMetadata(identifier(result.assets));
  if (value.javaVersion !== undefined) {
    requireMetadata(record(value.javaVersion) && Number.isSafeInteger(value.javaVersion.majorVersion)
      && typeof value.javaVersion.majorVersion === 'number' && value.javaVersion.majorVersion > 0 && value.javaVersion.majorVersion <= 1000);
    result.javaVersion = { majorVersion: value.javaVersion.majorVersion };
  }
  if (value.downloads !== undefined) {
    requireMetadata(record(value.downloads)); result.downloads = {};
    if (value.downloads.client !== undefined) result.downloads.client = parseArtifact(value.downloads.client);
  }
  if (value.assetIndex !== undefined) {
    requireMetadata(record(value.assetIndex) && identifier(value.assetIndex.id));
    result.assetIndex = { ...parseArtifact(value.assetIndex), id: value.assetIndex.id };
  }
  if (value.libraries !== undefined) {
    requireMetadata(Array.isArray(value.libraries) && value.libraries.length <= 10000);
    result.libraries = value.libraries.map(parseLibrary);
  }
  if (value.arguments !== undefined) {
    requireMetadata(record(value.arguments)); result.arguments = {};
    for (const key of ['game', 'jvm'] as const) if (value.arguments[key] !== undefined) result.arguments[key] = parseArguments(value.arguments[key]);
    requireMetadata(!(value.minecraftArguments !== undefined && value.arguments.game !== undefined));
  }
  return result;
}
