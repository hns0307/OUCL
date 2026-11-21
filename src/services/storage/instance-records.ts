import { createHash } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { identifier } from '../../core/version/validation.js';
import { resolveClientVersion } from '../../core/version/resolve.js';
import { installRelativePath, parseAssetIndex } from '../../core/install/assets.js';
import { planVanillaInstall } from '../../core/install/plan.js';
import type { ObjectRef } from '../objects/store.js';
import { definition } from '../objects/provenance.js';
import { isArtifactUrl } from '../download/types.js';
import type { DownloadSpec } from '../download/types.js';
import { isOfficialLoaderMetadataUrl } from '../loaders/metadata.js';
import { parseStoredLoaderProfile } from '../loaders/install-metadata.js';
import { composeLoaderInstall } from '../loaders/compose.js';
import type { LoaderLibraryPlan } from '../loaders/maven.js';
import { parseInstallerProfile } from '../../core/loaders/installer-profile.js';
import { enforceInstallerProcessorPolicy } from '../../core/loaders/processor-policy.js';
import { requireProcessorMainClass } from '../../core/loaders/processor-manifest.js';
import type { InstallerProcessorRole } from '../../core/loaders/types.js';
import { composeInstallerInstall } from '../loaders/installer-compose.js';
import { installerArtifactUrl } from '../loaders/installer-artifact.js';
import { sourceKey } from '../objects/provenance.js';
import { MAX_RECORD_BYTES, StorageError } from './files.js';

export interface InstanceSummary {
  instanceId: string; rootId: string; taskId: string; displayName: string; mcVersionId: string;
  isolation: 'inherit' | 'on' | 'off'; state: 'installing' | 'ready' | 'failed' | 'cancelled' | 'needsRecovery'; revision: number;
}
export interface InstanceIndex { items: InstanceSummary[] }
export interface PersistedInstallMetadata {
  versionDocuments: Record<string, string>; metadataSha1ByVersion: Record<string, string>; assetIndexBody: string;
  environment?: { os: 'windows'; arch: 'x64'; osVersion: string; features: Record<string, boolean> };
  loader?: PersistedLoaderMetadata;
}
export interface PersistedProfileLoaderMetadata {
  kind: 'fabric' | 'quilt'; version: string; profileBody: string; profileSourceUrl: string; profileSha256: string;
  libraries: Array<{ path: string; spec: DownloadSpec }>;
}
export interface PersistedProcessorOutput { path: string; size: number; sha1: string; sha256: string; upstreamSha1?: string }
export interface PersistedProcessorEvidence { role: InstallerProcessorRole; tool: string; mainClass: string; outputs: PersistedProcessorOutput[] }
export interface PersistedInstallerLoaderMetadata {
  kind: 'forge' | 'neoforge'; version: string; catalogSourceUrl: string; catalogSha256: string;
  installer: { sourceUrl: string; spec: DownloadSpec; object: ObjectRef };
  profileBody: string; profileSha256: string; versionBody: string; versionSha256: string;
  libraries: Array<{ path: string; spec: DownloadSpec }>; processors?: PersistedProcessorEvidence[];
}
export type PersistedLoaderMetadata = PersistedProfileLoaderMetadata | PersistedInstallerLoaderMetadata;
export type InstanceMetadata = PersistedInstallMetadata;
export interface InstanceReceipt { area: 'assets' | 'libraries' | 'version' | 'resources'; path: string; artifactId: string; mode: 'copy' | 'symlink' }
export type InstanceLoaderIdentity = { kind: 'vanilla' } | { kind: 'fabric' | 'quilt' | 'forge' | 'neoforge'; version: string };
export interface InstanceRecord {
  summary: InstanceSummary; phase: 'reserved' | 'prepared' | 'downloaded' | 'materializing' | 'ready' | 'failed' | 'cancelled' | 'needsRecovery';
  formatVersion?: 2; loader?: InstanceLoaderIdentity;
  modCommitId?: string;
  metadata?: InstanceMetadata; objects?: Record<string, ObjectRef>; receipts?: InstanceReceipt[];
}
function invalid(): never { throw new StorageError('INVALID_RECORD'); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function budget(value: unknown): void { if (Buffer.byteLength(JSON.stringify(value)) > MAX_RECORD_BYTES - 128) invalid(); }
const ARTIFACT = /^sha1-[a-f0-9]{40}$/;

/** Derives one fixed record domain from a UUID, never a user-provided record/file name. */
export function instanceRecordId(instanceId: string): string {
  if (!uuid(instanceId)) invalid(); return `instance-${instanceId.toLowerCase()}`;
}
/** Parses an exact summary; display names never become directory identifiers. */
export function parseInstanceSummary(value: unknown): InstanceSummary {
  if (!exactObject(value, ['instanceId', 'rootId', 'taskId', 'displayName', 'mcVersionId', 'isolation', 'state', 'revision'])
    || !uuid(value.instanceId) || !uuid(value.rootId) || !uuid(value.taskId) || typeof value.displayName !== 'string'
    || value.displayName.length < 1 || value.displayName.length > 80 || value.displayName.trim() !== value.displayName || /[\p{C}]/u.test(value.displayName)
    || !identifier(value.mcVersionId) || typeof value.isolation !== 'string' || !['inherit', 'on', 'off'].includes(value.isolation)
    || typeof value.state !== 'string' || !['installing', 'ready', 'failed', 'cancelled', 'needsRecovery'].includes(value.state)
    || !integer(value.revision) || value.revision < 1 || value.revision >= Number.MAX_SAFE_INTEGER) invalid();
  return { instanceId: value.instanceId.toLowerCase(), rootId: value.rootId.toLowerCase(), taskId: value.taskId.toLowerCase(),
    displayName: value.displayName, mcVersionId: value.mcVersionId, isolation: value.isolation as InstanceSummary['isolation'],
    state: value.state as InstanceSummary['state'], revision: value.revision };
}
/** Parses the bounded list independently of each instance's CAS envelope. */
export function parseInstanceIndex(value: unknown): InstanceIndex {
  try {
    if (!exactObject(value, ['items']) || !Array.isArray(value.items) || value.items.length > 1000) invalid();
    const items = value.items.map(parseInstanceSummary); const ids = new Set(items.map(item => item.instanceId));
    if (ids.size !== items.length) invalid(); const result = { items }; budget(result); return result;
  } catch { return invalid(); }
}
function environment(value: unknown): NonNullable<PersistedInstallMetadata['environment']> {
  if (!exactObject(value, ['os', 'arch', 'osVersion', 'features']) || value.os !== 'windows' || value.arch !== 'x64'
    || typeof value.osVersion !== 'string' || value.osVersion.length > 160 || /[\p{C}]/u.test(value.osVersion)
    || !object(value.features) || Object.keys(value.features).length > 64) invalid();
  const features = Object.fromEntries(Object.entries(value.features).map(([key, enabled]) => {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key) || typeof enabled !== 'boolean') invalid(); return [key, enabled];
  }));
  return { os: 'windows', arch: 'x64', osVersion: value.osVersion, features };
}
function profileLoaderMetadata(value: unknown, minecraftVersion: string, baseDocuments: Record<string, string>, baseProofs: Record<string, string>,
  assets: ReturnType<typeof parseAssetIndex>, selectedEnvironment: NonNullable<PersistedInstallMetadata['environment']>): PersistedProfileLoaderMetadata {
  if (!exactObject(value, ['kind', 'version', 'profileBody', 'profileSourceUrl', 'profileSha256', 'libraries'])
    || (value.kind !== 'fabric' && value.kind !== 'quilt') || !identifier(value.version) || !/^[a-zA-Z0-9_.+-]+$/.test(value.version)
    || typeof value.profileBody !== 'string' || typeof value.profileSourceUrl !== 'string' || typeof value.profileSha256 !== 'string'
    || !isOfficialLoaderMetadataUrl(value.profileSourceUrl) || !Array.isArray(value.libraries) || value.libraries.length > 256) invalid();
  const expectedSource = `https://meta.${value.kind === 'fabric' ? 'fabricmc.net/v2' : 'quiltmc.org/v3'}/versions/loader/${minecraftVersion}/${value.version}/profile/json`;
  if (value.profileSourceUrl !== expectedSource) invalid();
  let profile;
  try { profile = parseStoredLoaderProfile(value.kind, minecraftVersion, value.version, value.profileBody, value.profileSha256); }
  catch { return invalid(); }
  const libraries = value.libraries.map((entry, index) => {
    if (!exactObject(entry, ['path', 'spec']) || typeof entry.path !== 'string' || !exactObject(entry.spec, ['url', 'expected', 'anchor'])
      || typeof entry.spec.url !== 'string' || !isArtifactUrl(entry.spec.url)) invalid();
    const declared = profile.libraries[index]; if (!declared || declared.path !== entry.path || declared.url !== entry.spec.url) invalid();
    let facts;
    try { facts = definition(entry.spec.expected, entry.spec.anchor); } catch { return invalid(); }
    if (facts.expected.algorithm !== 'sha1' || facts.expected.provenanceId !== `loader:${value.kind}:${facts.expected.digest}`
      || (facts.anchor.kind !== 'loader-profile' && facts.anchor.kind !== 'loader-maven') || facts.anchor.algorithm !== 'sha256'
      || declared.proof === 'inline-sha1' && (facts.anchor.kind !== 'loader-profile' || facts.anchor.digest !== value.profileSha256
        || facts.expected.digest !== declared.sha1 || facts.expected.size !== declared.size)
      || declared.proof === 'official-sidecar-required' && facts.anchor.kind !== 'loader-maven') invalid();
    return { path: entry.path, spec: { url: entry.spec.url, expected: facts.expected, anchor: facts.anchor } };
  });
  if (libraries.length !== profile.libraries.length) invalid();
  const plan: LoaderLibraryPlan = { libraries, totalBytes: libraries.reduce((sum, entry) => sum + entry.spec.expected.size, 0) };
  if (!Number.isSafeInteger(plan.totalBytes)) invalid();
  try { composeLoaderInstall({ baseVersionDocuments: baseDocuments, baseMetadataSha1ByVersion: baseProofs, assets, profile,
    profileSha256: value.profileSha256, libraries: plan, environment: selectedEnvironment }); } catch { return invalid(); }
  return { kind: value.kind, version: value.version, profileBody: value.profileBody, profileSourceUrl: value.profileSourceUrl,
    profileSha256: value.profileSha256, libraries };
}

function downloadSpec(value: unknown): DownloadSpec {
  if (!exactObject(value, ['url', 'expected', 'anchor']) || typeof value.url !== 'string' || !isArtifactUrl(value.url)) invalid();
  let facts; try { facts = definition(value.expected, value.anchor); } catch { return invalid(); }
  return { url: value.url, expected: facts.expected, anchor: facts.anchor };
}
function objectRef(value: unknown): ObjectRef {
  if (!exactObject(value, ['digest', 'size', 'sourceKey']) || typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest)
    || !integer(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2 || typeof value.sourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceKey)) invalid();
  return { digest: value.digest, size: value.size, sourceKey: value.sourceKey };
}
const PROCESSOR_OUTPUTS: Readonly<Record<InstallerProcessorRole, readonly string[]>> = {
  'extract-mappings': ['MAPPINGS'], 'download-mojang-mappings': ['MOJMAPS'], 'merge-mappings': ['MERGED_MAPPINGS'],
  'split-client': ['MC_SLIM', 'MC_EXTRA'], 'rename-client': ['MC_SRG'], 'apply-client-patches': ['PATCHED'],
};

function installerLoaderMetadata(value: Record<string, unknown>, minecraftVersion: string, baseDocuments: Record<string, string>,
  baseProofs: Record<string, string>, assets: ReturnType<typeof parseAssetIndex>,
  selectedEnvironment: NonNullable<PersistedInstallMetadata['environment']>): PersistedInstallerLoaderMetadata {
  const hasProcessors = Object.hasOwn(value, 'processors');
  if (!exactObject(value, ['kind', 'version', 'catalogSourceUrl', 'catalogSha256', 'installer', 'profileBody', 'profileSha256',
    'versionBody', 'versionSha256', 'libraries', ...(hasProcessors ? ['processors'] : [])])
    || (value.kind !== 'forge' && value.kind !== 'neoforge') || !identifier(value.version)
    || typeof value.catalogSourceUrl !== 'string' || !isOfficialLoaderMetadataUrl(value.catalogSourceUrl)
    || typeof value.catalogSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.catalogSha256)
    || typeof value.profileBody !== 'string' || typeof value.profileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.profileSha256)
    || createHash('sha256').update(value.profileBody).digest('hex') !== value.profileSha256
    || typeof value.versionBody !== 'string' || typeof value.versionSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.versionSha256)
    || createHash('sha256').update(value.versionBody).digest('hex') !== value.versionSha256
    || !Array.isArray(value.libraries) || value.libraries.length > 256 || !object(value.installer)) invalid();
  const expectedCatalog = value.kind === 'forge' ? 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
    : 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
  if (value.catalogSourceUrl !== expectedCatalog) invalid();
  const installer = value.installer;
  if (!exactObject(installer, ['sourceUrl', 'spec', 'object']) || typeof installer.sourceUrl !== 'string'
    || installer.sourceUrl !== installerArtifactUrl(value.kind, minecraftVersion, value.version)) invalid();
  const installerSpec = downloadSpec(installer.spec); const installerObject = objectRef(installer.object);
  if (installerSpec.url !== installer.sourceUrl || installerSpec.expected.algorithm !== 'sha1'
    || installerSpec.expected.provenanceId !== `loader:${value.kind}:${installerSpec.expected.digest}`
    || installerSpec.anchor.kind !== 'loader-maven' || installerSpec.anchor.algorithm !== 'sha256'
    || installerObject.size !== installerSpec.expected.size || installerObject.sourceKey !== sourceKey(installerSpec.expected, installerSpec.anchor)) invalid();
  let profile;
  try { profile = parseInstallerProfile(value.kind, minecraftVersion, value.version, JSON.parse(value.profileBody) as unknown, JSON.parse(value.versionBody) as unknown); }
  catch { return invalid(); }
  const libraries = value.libraries.map((entry, index) => {
    if (!exactObject(entry, ['path', 'spec']) || typeof entry.path !== 'string') invalid();
    const spec = downloadSpec(entry.spec); const declared = profile.libraries[index];
    if (!declared || entry.path !== declared.path || spec.url !== declared.url || spec.expected.algorithm !== 'sha1'
      || spec.expected.digest !== declared.sha1 || spec.expected.size !== declared.size
      || spec.expected.provenanceId !== `loader:${value.kind}:${declared.sha1}`
      || spec.anchor.kind !== 'loader-profile' || spec.anchor.algorithm !== 'sha256' || spec.anchor.digest !== value.profileSha256) invalid();
    return { path: entry.path, spec };
  });
  if (libraries.length !== profile.libraries.length) invalid();
  const controlled = enforceInstallerProcessorPolicy(profile);
  let processors: PersistedProcessorEvidence[] | undefined;
  if (hasProcessors) {
    if (!Array.isArray(value.processors) || value.processors.length !== controlled.length) invalid();
    processors = value.processors.map((entry, index) => {
      const expected = controlled[index]!;
      if (!exactObject(entry, ['role', 'tool', 'mainClass', 'outputs']) || entry.role !== expected.role || entry.tool !== expected.tool
        || typeof entry.mainClass !== 'string' || !Array.isArray(entry.outputs)) invalid();
      try { requireProcessorMainClass(value.kind as 'forge' | 'neoforge', expected.role, entry.mainClass); } catch { return invalid(); }
      const outputKeys = PROCESSOR_OUTPUTS[expected.role]; if (entry.outputs.length !== outputKeys.length) invalid();
      const parsedOutputs = entry.outputs.map((output, outputIndex) => {
        const key = outputKeys[outputIndex]!; const declared = profile.data[key]; const proof = profile.data[`${key}_SHA`];
        if (!declared || declared.kind !== 'artifact' || !exactObject(output, ['path', 'size', 'sha1', 'sha256',
          ...(Object.hasOwn(output, 'upstreamSha1') ? ['upstreamSha1'] : [])]) || output.path !== declared.path
          || !integer(output.size) || output.size < 1 || output.size > 1024 ** 3 || typeof output.sha1 !== 'string' || !/^[a-f0-9]{40}$/.test(output.sha1)
          || typeof output.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(output.sha256)) invalid();
        const upstream = proof?.kind === 'literal' && /^[a-f0-9]{40}$/.test(proof.value) ? proof.value : undefined;
        if (upstream === undefined !== (output.upstreamSha1 === undefined) || upstream !== undefined && output.upstreamSha1 !== upstream
          || upstream !== undefined && output.sha1 !== upstream) invalid();
        return { path: output.path, size: output.size, sha1: output.sha1, sha256: output.sha256,
          ...(upstream === undefined ? {} : { upstreamSha1: upstream }) };
      });
      return { role: expected.role, tool: expected.tool, mainClass: entry.mainClass, outputs: parsedOutputs };
    });
  }
  try { composeInstallerInstall({ baseVersionDocuments: baseDocuments, baseMetadataSha1ByVersion: baseProofs, assets, profile,
    profileSha256: value.profileSha256, environment: selectedEnvironment }); } catch { return invalid(); }
  return { kind: value.kind, version: value.version, catalogSourceUrl: value.catalogSourceUrl, catalogSha256: value.catalogSha256,
    installer: { sourceUrl: installer.sourceUrl, spec: installerSpec, object: installerObject }, profileBody: value.profileBody,
    profileSha256: value.profileSha256, versionBody: value.versionBody, versionSha256: value.versionSha256, libraries,
    ...(processors === undefined ? {} : { processors }) };
}

function loaderMetadata(value: unknown, minecraftVersion: string, baseDocuments: Record<string, string>, baseProofs: Record<string, string>,
  assets: ReturnType<typeof parseAssetIndex>, selectedEnvironment: NonNullable<PersistedInstallMetadata['environment']>): PersistedLoaderMetadata {
  if (!object(value) || typeof value.kind !== 'string') invalid();
  return value.kind === 'fabric' || value.kind === 'quilt'
    ? profileLoaderMetadata(value, minecraftVersion, baseDocuments, baseProofs, assets, selectedEnvironment)
    : installerLoaderMetadata(value, minecraftVersion, baseDocuments, baseProofs, assets, selectedEnvironment);
}
function metadata(value: unknown, versionId: string): InstanceMetadata {
  const hasEnvironment = object(value) && Object.hasOwn(value, 'environment');
  const hasLoader = object(value) && Object.hasOwn(value, 'loader');
  if (!exactObject(value, ['versionDocuments', 'metadataSha1ByVersion', 'assetIndexBody', ...(hasEnvironment ? ['environment'] : []), ...(hasLoader ? ['loader'] : [])]) || !object(value.versionDocuments)
    || !object(value.metadataSha1ByVersion) || typeof value.assetIndexBody !== 'string') invalid();
  const entries = Object.entries(value.versionDocuments); const hashes = Object.entries(value.metadataSha1ByVersion);
  if (entries.length === 0 || entries.length > 32 || hashes.length !== entries.length) invalid();
  let bytes = Buffer.byteLength(value.assetIndexBody); if (bytes > 2 * 1024 ** 2) invalid();
  const documents: [string, string][] = []; const sha1s: [string, string][] = []; const parsed: [string, unknown][] = [];
  for (const [id, body] of entries) {
    const sha1 = value.metadataSha1ByVersion[id];
    if (!identifier(id) || typeof body !== 'string') invalid();
    bytes += Buffer.byteLength(body); if (bytes > 2 * 1024 ** 2) invalid();
    if (!Object.hasOwn(value.metadataSha1ByVersion, id) || typeof sha1 !== 'string'
      || !/^[a-f0-9]{40}$/.test(sha1) || createHash('sha1').update(body).digest('hex') !== sha1) invalid();
    documents.push([id, body]); sha1s.push([id, sha1]); parsed.push([id, JSON.parse(body) as unknown]);
  }
  const selectedEnvironment = hasEnvironment ? environment(value.environment) : undefined;
  const resolved = resolveClientVersion(versionId, Object.fromEntries(parsed), selectedEnvironment ?? { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
  if (resolved.ancestry.length !== entries.length || !resolved.assetIndex || Buffer.byteLength(value.assetIndexBody) !== resolved.assetIndex.size
    || createHash('sha1').update(value.assetIndexBody).digest('hex') !== resolved.assetIndex.sha1) invalid();
  const assetIndex = parseAssetIndex(JSON.parse(value.assetIndexBody) as unknown);
  planVanillaInstall(resolved, Object.fromEntries(sha1s), assetIndex);
  if (hasLoader && selectedEnvironment === undefined) invalid();
  const parsedLoader = hasLoader ? loaderMetadata(value.loader, versionId, Object.fromEntries(documents), Object.fromEntries(sha1s), assetIndex, selectedEnvironment!) : undefined;
  return { versionDocuments: Object.fromEntries(documents), metadataSha1ByVersion: Object.fromEntries(sha1s), assetIndexBody: value.assetIndexBody,
    ...(selectedEnvironment === undefined ? {} : { environment: selectedEnvironment }), ...(parsedLoader === undefined ? {} : { loader: parsedLoader }) };
}
function objects(value: unknown): Record<string, ObjectRef> {
  if (!object(value) || Object.keys(value).length > 100000) invalid();
  return Object.fromEntries(Object.entries(value).map(([id, entry]) => {
    if (!ARTIFACT.test(id) || !exactObject(entry, ['digest', 'size', 'sourceKey']) || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest)
      || !integer(entry.size) || entry.size > 64 * 1024 ** 3 || typeof entry.sourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceKey)) invalid();
    return [id, { digest: entry.digest, size: entry.size, sourceKey: entry.sourceKey }];
  }));
}
function receipts(value: unknown, refs: Record<string, ObjectRef>): InstanceReceipt[] {
  if (!Array.isArray(value) || value.length > 200000) invalid(); const seen = new Set<string>(); const parents = new Set<string>();
  return value.map(entry => {
    if (!exactObject(entry, ['area', 'path', 'artifactId', 'mode']) || typeof entry.area !== 'string' || !['assets', 'libraries', 'version', 'resources'].includes(entry.area)
      || typeof entry.path !== 'string' || typeof entry.artifactId !== 'string' || !ARTIFACT.test(entry.artifactId) || !Object.hasOwn(refs, entry.artifactId)
      || typeof entry.mode !== 'string' || !['copy', 'symlink'].includes(entry.mode)) invalid();
    const name = installRelativePath(entry.path); const key = `${entry.area as string}:${name.toLowerCase()}`;
    if (seen.has(key) || parents.has(key)) invalid(); seen.add(key);
    const parts = name.toLowerCase().split('/'); parts.pop();
    while (parts.length) { const parent = `${entry.area as string}:${parts.join('/')}`; if (seen.has(parent)) invalid(); parents.add(parent); parts.pop(); }
    return { area: entry.area as InstanceReceipt['area'], path: name, artifactId: entry.artifactId, mode: entry.mode as InstanceReceipt['mode'] };
  });
}
function loader(value: unknown): InstanceLoaderIdentity {
  if (exactObject(value, ['kind']) && value.kind === 'vanilla') return { kind: 'vanilla' };
  if (!exactObject(value, ['kind', 'version']) || typeof value.kind !== 'string' || !['fabric', 'quilt', 'forge', 'neoforge'].includes(value.kind)
    || !identifier(value.version) || !/^[a-zA-Z0-9_.+-]+$/.test(value.version)) invalid();
  return { kind: value.kind as Exclude<InstanceLoaderIdentity['kind'], 'vanilla'>, version: value.version };
}

/** Validates local integrity and shape only; initial official trust and materialized-file checks remain service responsibilities. */
export function parseInstanceRecord(value: unknown): InstanceRecord {
  try {
    if (!object(value)) invalid();
    budget(value);
    const versioned = Object.hasOwn(value, 'formatVersion') || Object.hasOwn(value, 'loader');
    if (versioned && (!Object.hasOwn(value, 'formatVersion') || !Object.hasOwn(value, 'loader') || value.formatVersion !== 2)) invalid();
    const optional = ['formatVersion', 'loader', 'metadata', 'objects', 'receipts', 'modCommitId'].filter(key => Object.hasOwn(value, key));
    if (!exactObject(value, ['summary', 'phase', ...optional])) invalid();
    const summary = parseInstanceSummary(value.summary); const phase = value.phase;
    if (typeof phase !== 'string' || !['reserved', 'prepared', 'downloaded', 'materializing', 'ready', 'failed', 'cancelled', 'needsRecovery'].includes(phase)
      || summary.state !== (['reserved', 'prepared', 'downloaded', 'materializing'].includes(phase) ? 'installing' : phase)) invalid();
    const parsedMetadata = value.metadata === undefined ? undefined : metadata(value.metadata, summary.mcVersionId);
    const parsedLoader = versioned ? loader(value.loader) : { kind: 'vanilla' as const };
    if (Object.hasOwn(value, 'modCommitId') && (!versioned || !uuid(value.modCommitId) || phase !== 'ready' || parsedLoader.kind === 'vanilla')) invalid();
    const parsedObjects = value.objects === undefined ? undefined : objects(value.objects);
    const parsedReceipts = value.receipts === undefined ? undefined : receipts(value.receipts, parsedObjects ?? {});
    const metadataLoader = parsedMetadata?.loader;
    if (phase === 'ready' && (metadataLoader?.kind === 'forge' || metadataLoader?.kind === 'neoforge') && !metadataLoader.processors) invalid();
    if (metadataLoader !== undefined) {
      if (parsedLoader.kind === 'vanilla' || parsedLoader.kind !== metadataLoader.kind || parsedLoader.version !== metadataLoader.version) invalid();
    } else if (parsedLoader.kind !== 'vanilla' && ['prepared', 'downloaded', 'materializing', 'ready'].includes(phase as string)) invalid();
    if (['prepared', 'downloaded', 'materializing', 'ready'].includes(phase) && !parsedMetadata
      || ['downloaded', 'materializing', 'ready'].includes(phase) && !parsedObjects
      || phase === 'ready' && (!parsedReceipts || !parsedObjects || Object.keys(parsedObjects).length === 0 || parsedReceipts.length === 0)
      || parsedObjects && !parsedMetadata || parsedReceipts && !parsedObjects
      || optional.some(key => value[key] === undefined)) invalid();
    const result: InstanceRecord = { formatVersion: 2, loader: parsedLoader, summary, phase: phase as InstanceRecord['phase'], ...(parsedMetadata === undefined ? {} : { metadata: parsedMetadata }),
      ...(parsedObjects === undefined ? {} : { objects: parsedObjects }), ...(parsedReceipts === undefined ? {} : { receipts: parsedReceipts }),
      ...(value.modCommitId === undefined ? {} : { modCommitId: (value.modCommitId as string).toLowerCase() }) };
    budget(result); return result;
  } catch { return invalid(); }
}
