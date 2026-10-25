import { createHash } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { identifier } from '../../core/version/validation.js';
import { resolveClientVersion } from '../../core/version/resolve.js';
import { installRelativePath, parseAssetIndex } from '../../core/install/assets.js';
import { planVanillaInstall } from '../../core/install/plan.js';
import type { ObjectRef } from '../objects/store.js';
import { MAX_RECORD_BYTES, StorageError } from './files.js';

export interface InstanceSummary {
  instanceId: string; rootId: string; taskId: string; displayName: string; mcVersionId: string;
  isolation: 'inherit' | 'on' | 'off'; state: 'installing' | 'ready' | 'failed' | 'cancelled' | 'needsRecovery'; revision: number;
}
export interface InstanceIndex { items: InstanceSummary[] }
export interface PersistedInstallMetadata {
  versionDocuments: Record<string, string>; metadataSha1ByVersion: Record<string, string>; assetIndexBody: string;
  environment?: { os: 'windows'; arch: 'x64'; osVersion: string; features: Record<string, boolean> };
}
export type InstanceMetadata = PersistedInstallMetadata;
export interface InstanceReceipt { area: 'assets' | 'libraries' | 'version' | 'resources'; path: string; artifactId: string; mode: 'copy' | 'symlink' }
export interface InstanceRecord {
  summary: InstanceSummary; phase: 'reserved' | 'prepared' | 'downloaded' | 'materializing' | 'ready' | 'failed' | 'cancelled' | 'needsRecovery';
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
function metadata(value: unknown, versionId: string): InstanceMetadata {
  const hasEnvironment = object(value) && Object.hasOwn(value, 'environment');
  if (!exactObject(value, ['versionDocuments', 'metadataSha1ByVersion', 'assetIndexBody', ...(hasEnvironment ? ['environment'] : [])]) || !object(value.versionDocuments)
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
  return { versionDocuments: Object.fromEntries(documents), metadataSha1ByVersion: Object.fromEntries(sha1s), assetIndexBody: value.assetIndexBody,
    ...(selectedEnvironment === undefined ? {} : { environment: selectedEnvironment }) };
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

/** Validates local integrity and shape only; initial official trust and materialized-file checks remain service responsibilities. */
export function parseInstanceRecord(value: unknown): InstanceRecord {
  try {
    if (!object(value)) invalid();
    budget(value);
    const optional = ['metadata', 'objects', 'receipts'].filter(key => Object.hasOwn(value, key));
    if (!exactObject(value, ['summary', 'phase', ...optional])) invalid();
    const summary = parseInstanceSummary(value.summary); const phase = value.phase;
    if (typeof phase !== 'string' || !['reserved', 'prepared', 'downloaded', 'materializing', 'ready', 'failed', 'cancelled', 'needsRecovery'].includes(phase)
      || summary.state !== (['reserved', 'prepared', 'downloaded', 'materializing'].includes(phase) ? 'installing' : phase)) invalid();
    const parsedMetadata = value.metadata === undefined ? undefined : metadata(value.metadata, summary.mcVersionId);
    const parsedObjects = value.objects === undefined ? undefined : objects(value.objects);
    const parsedReceipts = value.receipts === undefined ? undefined : receipts(value.receipts, parsedObjects ?? {});
    if (['prepared', 'downloaded', 'materializing', 'ready'].includes(phase) && !parsedMetadata
      || ['downloaded', 'materializing', 'ready'].includes(phase) && !parsedObjects
      || phase === 'ready' && (!parsedReceipts || !parsedObjects || Object.keys(parsedObjects).length === 0 || parsedReceipts.length === 0)
      || parsedObjects && !parsedMetadata || parsedReceipts && !parsedObjects
      || optional.some(key => value[key] === undefined)) invalid();
    const result: InstanceRecord = { summary, phase: phase as InstanceRecord['phase'], ...(parsedMetadata === undefined ? {} : { metadata: parsedMetadata }),
      ...(parsedObjects === undefined ? {} : { objects: parsedObjects }), ...(parsedReceipts === undefined ? {} : { receipts: parsedReceipts }) };
    budget(result); return result;
  } catch { return invalid(); }
}
