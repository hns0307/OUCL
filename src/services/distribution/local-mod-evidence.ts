import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import type { ModArchiveScan } from '../mods/archive.js';
import { guardDirectory } from '../storage/files.js';
import { parseModArchiveReply } from '../workers/mod-archive-protocol.js';
import { transactionDigest } from './transaction-record.js';
import type { DistributionPlan } from './transaction-record.js';
import { LocalModDomainError } from './local-mod-domain-types.js';
import type { LocalArtifactEvidence, LocalModDomainContext, LocalModDomainPorts } from './local-mod-domain-types.js';

export interface LocalArtifactStamp { dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string }
export interface InspectedLocalModArtifact { evidence: LocalArtifactEvidence; stamp: LocalArtifactStamp; scan: ModArchiveScan }

/** Cancellation is checked after each main-owned asynchronous port settles; it never implies IO has exited. */
export function checkDomainSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LocalModDomainError('CANCELLED');
}
function reject(code: ConstructorParameters<typeof LocalModDomainError>[0]): never { throw new LocalModDomainError(code); }
function versions(value: unknown): value is Record<string, string | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length > 64) return false;
  return Object.entries(value).every(([key, version]) => /^[A-Za-z0-9_.-]{1,128}$/.test(key)
    && (version === null || typeof version === 'string' && version.length > 0 && version.length <= 160));
}
function javaMajor(version: string): number | undefined {
  const match = /^(?:1\.(\d+)|(\d+))(?:[._+-]|$)/.exec(version);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

/** Binds measured runtime facts to the plan and checks the actual game namespace inode, without creating directories. */
export async function readLocalModContext(plan: DistributionPlan, ports: Pick<LocalModDomainPorts, 'readContext'>,
  signal?: AbortSignal): Promise<LocalModDomainContext> {
  try {
    plan = structuredClone(plan);
    checkDomainSignal(signal); const raw: unknown = await ports.readContext(structuredClone(plan), signal); checkDomainSignal(signal);
    const value: unknown = structuredClone(raw);
    if (!exactObject(value, ['rootId', 'gameIdentity', 'context']) || value.rootId !== plan.rootId
      || !exactObject(value.gameIdentity, ['dev', 'ino']) || ![value.gameIdentity.dev, value.gameIdentity.ino].every(part => typeof part === 'string' && /^\d{1,30}$/.test(part))
      || !exactObject(value.context, ['instanceId', 'revision', 'modsDirectory', 'environment'])
      || value.context.instanceId !== plan.instanceId || value.context.revision !== plan.instanceRevision
      || typeof value.context.modsDirectory !== 'string' || !path.isAbsolute(value.context.modsDirectory)
      || path.basename(value.context.modsDirectory).toLowerCase() !== 'mods') reject('FILES_CHANGED');
    const environment = value.context.environment;
    if (!exactObject(environment, ['loader', 'versions', 'languageVersions']) || !versions(environment.versions)
      || !versions(environment.languageVersions)) reject('INVALID_DOMAIN_INPUT');
    const expected = plan.manifest.target;
    if (environment.loader !== expected.loader || environment.versions.minecraft !== expected.minecraft) reject('FILES_CHANGED');
    if (typeof environment.versions.java !== 'string') reject('MODS_UNDETERMINED');
    if (javaMajor(environment.versions.java) !== expected.javaMajor) reject('MODS_UNDETERMINED');
    if (expected.loader !== 'vanilla') {
      const loaderId = { fabric: 'fabricloader', quilt: 'quilt_loader', forge: 'forge', neoforge: 'neoforge' }[expected.loader];
      if (typeof environment.versions[loaderId] !== 'string') reject('MODS_UNDETERMINED');
      if (environment.versions[loaderId] !== expected.loaderVersion) reject('FILES_CHANGED');
    }
    const directory = await guardDirectory(path.dirname(value.context.modsDirectory)); checkDomainSignal(signal);
    const info = await lstat(directory, { bigint: true }); checkDomainSignal(signal);
    if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n || String(info.dev) !== value.gameIdentity.dev
      || String(info.ino) !== value.gameIdentity.ino) reject('FILES_CHANGED');
    return { rootId: plan.rootId, gameIdentity: { dev: String(info.dev), ino: String(info.ino) },
      context: { instanceId: plan.instanceId, revision: plan.instanceRevision, modsDirectory: value.context.modsDirectory,
        environment: { loader: expected.loader, versions: structuredClone(environment.versions),
          languageVersions: structuredClone(environment.languageVersions) } } };
  } catch (error) {
    checkDomainSignal(signal);
    throw error instanceof LocalModDomainError ? error : new LocalModDomainError('FILES_CHANGED');
  }
}

function parseEvidence(plan: DistributionPlan, index: number, value: unknown): LocalArtifactEvidence {
  const operation = plan.manifest.operations[index];
  if (!Number.isSafeInteger(index) || index < 0 || !operation || operation.kind !== 'add' && operation.kind !== 'replace') reject('INVALID_DOMAIN_INPUT');
  if (!exactObject(value, ['binding', 'path', 'permission']) || !exactObject(value.binding, ['planDigest', 'operationIndex', 'artifactId', 'sha256', 'size'])
    || value.binding.planDigest !== transactionDigest(plan) || value.binding.operationIndex !== index || value.binding.artifactId !== operation.artifactId
    || value.binding.sha256 !== operation.sha256 || value.binding.size !== operation.size
    || typeof value.path !== 'string' || value.path.length > 32767 || !path.isAbsolute(value.path)) reject('ARTIFACT_UNVERIFIED');
  if (value.permission === 'denied') reject('PERMISSION_DENIED');
  if (value.permission !== 'verified') reject('PERMISSION_UNKNOWN');
  return { binding: { planDigest: transactionDigest(plan), operationIndex: index, artifactId: operation.artifactId,
    sha256: operation.sha256, size: operation.size }, path: value.path, permission: 'verified' };
}
async function stamp(file: string): Promise<LocalArtifactStamp> {
  const info = await lstat(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.ino === 0n || info.size < 1n || info.size > 64n * 1024n ** 2n) reject('ARTIFACT_UNVERIFIED');
  return { dev: String(info.dev), ino: String(info.ino), size: Number(info.size), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) };
}

/** Reads only explicitly resolved local bytes; a signed hash or a valid JAR alone never supplies redistribution permission. */
export async function inspectLocalModArtifact(plan: DistributionPlan, index: number,
  ports: Pick<LocalModDomainPorts, 'resolveLocalArtifact' | 'scanner'>, signal?: AbortSignal): Promise<InspectedLocalModArtifact> {
  try {
    plan = structuredClone(plan);
    checkDomainSignal(signal);
    const evidence = parseEvidence(plan, index, await ports.resolveLocalArtifact(structuredClone(plan), index, signal)); checkDomainSignal(signal);
    const directory = await guardDirectory(path.dirname(evidence.path)); checkDomainSignal(signal);
    evidence.path = path.join(directory, path.basename(evidence.path));
    const before = await stamp(evidence.path); checkDomainSignal(signal);
    if (before.size !== evidence.binding.size) reject('ARTIFACT_UNVERIFIED');
    const observed = await ports.scanner.read(evidence.path, signal); checkDomainSignal(signal);
    const result = structuredClone(observed);
    const reply = parseModArchiveReply({ version: 1, kind: 'mod-archive-result', result });
    if (reply.kind !== 'mod-archive-result' || reply.result.sha256 !== evidence.binding.sha256 || reply.result.size !== evidence.binding.size) reject('ARTIFACT_UNVERIFIED');
    await guardDirectory(path.dirname(evidence.path)); checkDomainSignal(signal);
    const after = await stamp(evidence.path); checkDomainSignal(signal);
    if (transactionDigest(before) !== transactionDigest(after)) reject('FILES_CHANGED');
    return { evidence, stamp: after, scan: structuredClone(reply.result) };
  } catch (error) {
    checkDomainSignal(signal);
    throw error instanceof LocalModDomainError ? error : new LocalModDomainError('ARTIFACT_UNVERIFIED');
  }
}
