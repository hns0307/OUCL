import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { checkLocalMods } from '../../core/mods/check.js';
import type { LocalModCheck } from '../../core/mods/check.js';
import { checkPlatformMods } from '../../core/mods/platform.js';
import type { DualModCheck, PlatformModVersion } from '../../core/mods/platform.js';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { ModContractError } from '../../shared/contracts/mods.js';
import type { ModCode, ModPlanItem } from '../../shared/contracts/mods.js';
import type { DownloadSpec } from '../download/types.js';
import type { InstallerService } from '../install/installer.js';
import type { ObjectRef } from '../objects/store.js';
import { sourceKey } from '../objects/provenance.js';
import { guardDirectory, hasCode } from '../storage/files.js';
import { parseStoredModPlan } from '../storage/mod-plans.js';
import type { StoredModPlan } from '../storage/mod-plans.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { ModArchiveReader } from '../workers/mod-archive-reader.js';
import { ModArchiveError } from './archive.js';
import type { ModArchiveScan } from './archive.js';
import { isModrinthFileUrl } from '../resources/modrinth.js';
import type { ModInventoryContext, ModInventoryService } from './inventory.js';
import type { ModInspectionService } from './inspection.js';
import type { ModLibraryReader } from './library.js';
import type { ModInstallPlanner } from './planner.js';
import type { ModrinthModClient } from './modrinth.js';
import { plannedModFacts, platformFacts } from './facts.js';

export interface ModConfirmation { planRequestId: string; planId: string; confirmed: true }
export interface PreparedModFile { item: ModPlanItem; object: ObjectRef; spec: DownloadSpec; scan: ModArchiveScan }
export interface ModPreparationAssessment { local: LocalModCheck; platform: DualModCheck }
export interface PreparedModInstall {
  rootId: string; consumerId: string; planRequestId: string; planId: string; instanceId: string; instanceRevision: number;
  fingerprint: string; files: PreparedModFile[]; assessment: ModPreparationAssessment;
}
export interface ModPreparationProgress { stage: 'checking' | 'downloading' | 'verifying' | 'ready'; bytesDone: number; bytesTotal: number }
export class ModPreparationError extends ModContractError {
  constructor(code: ModCode, readonly assessment?: ModPreparationAssessment) { super(code); this.name = 'ModPreparationError'; }
}
type Repository = Pick<StorageClient, 'readInstallation' | 'readModPlan' | 'readGameSessions'>;
interface Dependencies {
  planner: Pick<ModInstallPlanner, 'plan'>; library: Pick<ModLibraryReader, 'read'>;
  inspections: Pick<ModInspectionService, 'check'>; inventory: Pick<ModInventoryService, 'scan'>;
  context: (instanceId: string, signal?: AbortSignal) => Promise<ModInventoryContext>;
  platform: Pick<ModrinthModClient, 'version'>; transfer: Pick<InstallerService, 'transferResource'>;
  scanner: Pick<ModArchiveReader, 'read'>;
}
async function stamp(file: string): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new ModContractError('MODS_UNSAFE');
  return JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
}
function pinnedFile(item: ModPlanItem, version: PlatformModVersion) {
  const files = version.files.filter(file => file.filename === item.filename && file.sha1 === item.fileId
    && file.sha512 === item.sha512 && file.size === item.size);
  if (version.projectId !== item.projectId || version.versionId !== item.versionId || files.length !== 1) throw new ModContractError('UNTRUSTED_METADATA');
  return files[0]!;
}
function specification(item: ModPlanItem, version: PlatformModVersion): DownloadSpec {
  const file = pinnedFile(item, version);
  if (!isModrinthFileUrl(file.url) || !new URL(file.url).pathname.startsWith(`/data/${item.projectId}/`)
    || version.evidence.url !== `https://api.modrinth.com/v2/version/${item.versionId}`
    || !/^[a-f0-9]{64}$/.test(version.evidence.sha256)) throw new ModContractError('UNTRUSTED_METADATA');
  return { url: file.url, expected: { algorithm: 'sha1', digest: item.fileId, size: item.size,
    provenanceId: `modrinth:${item.projectId}:${item.versionId}:${item.fileId}` },
    anchor: { kind: 'modrinth-version', algorithm: 'sha256', digest: version.evidence.sha256 } };
}

/** Downloads only confirmed exact plan files into the trusted object store, then checks real prospective JAR facts.
 * This private preparation does not publish a Mod, change an instance revision or claim an installation transaction.
 */
export class ModInstallPreparation {
  private active = false;
  constructor(private readonly storage: Repository, private readonly dependencies: Dependencies) {}

  private async saved(input: ModConfirmation): Promise<StoredModPlan> {
    const stored = await this.storage.readModPlan(input.planRequestId);
    if (!stored) throw new ModContractError('NOT_FOUND');
    const record = parseStoredModPlan(stored.data);
    if (record.requestId !== input.planRequestId || record.plan.planId !== input.planId) throw new ModContractError('REVISION_CONFLICT');
    if (record.status !== 'preview') throw new ModContractError('CANCELLED');
    if (record.plan.state !== 'ready') throw new ModContractError(record.plan.state === 'conflict' ? 'MODS_INCOMPATIBLE' : 'MODS_UNDETERMINED');
    return record;
  }
  private async idle(rootId: string, context: ModInventoryContext): Promise<void> {
    const sessions = await this.storage.readGameSessions();
    if (sessions?.data.items.some(item => item.rootId === rootId && item.snapshot.instanceId === context.instanceId
      && item.snapshot.state !== 'exited')) throw new ModContractError('INSTANCE_BUSY');
    try { await lstat(path.join(path.dirname(context.modsDirectory), 'oucl.session.lock')); }
    catch (error) { if (hasCode(error, 'ENOENT')) return; throw error; }
    throw new ModContractError('INSTANCE_BUSY');
  }
  async prepare(input: ModConfirmation, consumerId: string, signal?: AbortSignal,
    progress?: (value: ModPreparationProgress) => void): Promise<PreparedModInstall> {
    if (!exactObject(input, ['planRequestId', 'planId', 'confirmed']) || input.confirmed !== true) throw new ModContractError('CONFIRMATION_REQUIRED');
    if (!UUID_PATTERN.test(input.planRequestId) || !/^[a-f0-9]{64}$/.test(input.planId) || !UUID_PATTERN.test(consumerId)) throw new ModContractError('INVALID_ARGUMENT');
    if (this.active) throw new ModContractError('SCAN_BUSY'); this.active = true;
    const confirmed = { ...input, planRequestId: input.planRequestId.toLowerCase() };
    const check = (): void => { if (signal?.aborted) throw new ModContractError('CANCELLED'); };
    try {
      check(); const saved = await this.saved(confirmed); check(); const plan = saved.plan;
      const root = await this.storage.readInstallation(); check();
      if (!root || root.data.rootId !== saved.rootId) throw new ModContractError('ROOT_UNAVAILABLE');
      await guardDirectory(root.data.dataDirectory); check();
      const context = structuredClone(await this.dependencies.context(plan.instanceId, signal)); check();
      if (context.instanceId !== plan.instanceId || context.revision !== plan.instanceRevision
        || context.environment.loader !== plan.loader || context.environment.versions.minecraft !== plan.minecraft) throw new ModContractError('REVISION_CONFLICT');
      const contextSnapshot = JSON.stringify(context); await this.idle(saved.rootId, context); check();
      const emit = (stage: ModPreparationProgress['stage'], bytesDone: number): void => { progress?.({ stage, bytesDone, bytesTotal: plan.totalDownloadBytes }); check(); };
      emit('checking', 0);
      const refreshed = await this.dependencies.planner.plan(structuredClone(saved.input), signal); check();
      if (refreshed.planId !== plan.planId) throw new ModContractError('FILES_CHANGED');
      const initial = structuredClone(await this.dependencies.inspections.check(plan.instanceId, plan.instanceRevision, signal)); check();
      if (initial.inventory.fingerprint !== plan.fingerprint) throw new ModContractError('FILES_CHANGED');
      const filenames = new Set(initial.inventory.items.map(item => item.filename.toLowerCase()));
      if (initial.inventory.items.length + plan.items.filter(item => item.disposition !== 'reuse').length > 256) throw new ModContractError('MOD_LIMIT');
      for (const item of plan.items.filter(item => item.disposition !== 'reuse')) {
        if (!item.filename.toLowerCase().endsWith('.jar') || filenames.has(item.filename.toLowerCase())) throw new ModContractError('MODS_UNSAFE');
        filenames.add(item.filename.toLowerCase());
      }
      const rootLibrary = structuredClone(await this.dependencies.library.read(saved.input.root, signal)); check();
      if (rootLibrary.scan.archives.some(archive => archive.entries.length > 0
        || archive.documents.some(document => document.name === 'META-INF/jarjar/metadata.json'))) throw new ModContractError('MODS_UNDETERMINED');
      const versions = new Map<string, PlatformModVersion>();
      for (const association of initial.platform.files) {
        if (association.status === 'matched' && association.version) for (const file of association.version.files) versions.set(file.sha512, association.version);
      }
      const files: PreparedModFile[] = []; let bytesDone = 0; let factsBytes = Buffer.byteLength(JSON.stringify(initial));
      const objectStamps = new Map<string, string>();
      for (const item of plan.items) {
        check(); await this.saved(confirmed); check();
        if (item.disposition === 'reuse') {
          const matches = initial.inventory.items.filter(file => file.enabled && file.sha1 === item.fileId && file.sha512 === item.sha512 && file.size === item.size);
          const version = versions.get(item.sha512);
          if (matches.length !== 1 || !version) throw new ModContractError('FILES_CHANGED');
          pinnedFile(item, version); continue;
        }
        let object: ObjectRef; let spec: DownloadSpec; let version: PlatformModVersion;
        if (item.disposition === 'library') {
          if (item.versionId !== saved.input.root.versionId || !rootLibrary.record.object) throw new ModContractError('UNTRUSTED_METADATA');
          version = rootLibrary.version; pinnedFile(item, version); object = rootLibrary.record.object; spec = rootLibrary.record.spec;
        } else {
          if (item.versionId === plan.rootVersionId) throw new ModContractError('UNTRUSTED_METADATA');
          version = structuredClone(await this.dependencies.platform.version(item.versionId, signal)); check(); spec = specification(item, version);
          emit('downloading', bytesDone);
          object = await this.dependencies.transfer.transferResource(spec, consumerId, { ...(signal ? { signal } : {}), onProgress: done => {
            if (Number.isSafeInteger(done) && done >= 0 && done <= item.size) emit('downloading', bytesDone + done);
          } }); check(); bytesDone += item.size;
        }
        if (!/^[a-f0-9]{64}$/.test(object.digest) || object.size !== item.size || object.sourceKey !== sourceKey(spec.expected, spec.anchor)) throw new ModContractError('UNTRUSTED_METADATA');
        const file = path.join(root.data.dataDirectory, 'store/objects/sha256', object.digest.slice(0, 2), object.digest);
        emit('verifying', bytesDone); const before = await stamp(file); const scan = await this.dependencies.scanner.read(file, signal); check();
        if (scan.size !== item.size || scan.sha1 !== item.fileId || scan.sha256 !== object.digest || scan.sha512 !== item.sha512) throw new ModContractError('UNTRUSTED_METADATA');
        if (await stamp(file) !== before) throw new ModContractError('FILES_CHANGED');
        objectStamps.set(file, before);
        factsBytes += Buffer.byteLength(JSON.stringify(scan)) + Buffer.byteLength(JSON.stringify(version));
        if (factsBytes > 8 * 1024 ** 2) throw new ModContractError('MOD_LIMIT');
        files.push({ item: structuredClone(item), object: structuredClone(object), spec: structuredClone(spec), scan });
        versions.set(item.sha512, version);
      }
      check(); const prospective = [...initial.inventory.items, ...files.map(file => plannedModFacts(plan.instanceId, file.item.filename, file.scan))];
      const local = checkLocalMods(prospective, context.environment);
      // A server-only JAR can be a valid archive, but it cannot be automatically installed as a client Mod.
      for (const file of prospective.slice(initial.inventory.items.length)) if (!local.providers.some(provider => provider.fileId === file.fileId)
        && local.issues.some(issue => issue.fileId === file.fileId && issue.code === 'SERVER_ONLY_MOD')) local.state = 'unsatisfied';
      const platform = checkPlatformMods(local.state, platformFacts(prospective), context.environment, versions);
      const assessment = { local, platform };
      if (local.state === 'unsatisfied' || platform.state === 'unsatisfied') throw new ModPreparationError('MODS_INCOMPATIBLE', assessment);
      if (local.state !== 'satisfied' || platform.state !== 'satisfied' || initial.platformFailures.length) throw new ModPreparationError('MODS_UNDETERMINED', assessment);
      const final = await this.dependencies.inventory.scan(plan.instanceId, plan.instanceRevision, signal); check();
      if (final.fingerprint !== plan.fingerprint) throw new ModContractError('FILES_CHANGED');
      if (JSON.stringify(await this.dependencies.context(plan.instanceId, signal)) !== contextSnapshot) throw new ModContractError('REVISION_CONFLICT');
      for (const [file, before] of objectStamps) {
        check(); await guardDirectory(path.dirname(file)); if (await stamp(file) !== before) throw new ModContractError('FILES_CHANGED');
      }
      const latestRoot = await this.storage.readInstallation(); check();
      if (JSON.stringify(latestRoot?.data) !== JSON.stringify(root.data)) throw new ModContractError('FILES_CHANGED');
      await this.saved(confirmed); await this.idle(saved.rootId, context); check(); emit('ready', bytesDone);
      return { rootId: saved.rootId, consumerId: consumerId.toLowerCase(), planRequestId: confirmed.planRequestId, planId: plan.planId,
        instanceId: plan.instanceId, instanceRevision: plan.instanceRevision, fingerprint: final.fingerprint, files, assessment };
    } catch (error) {
      check(); if (error instanceof ModArchiveError) throw new ModContractError(error.code === 'ARCHIVE_LIMIT' ? 'MOD_LIMIT'
        : ['INVALID_ARCHIVE', 'UNSAFE_ARCHIVE'].includes(error.code) ? 'MODS_UNSAFE' : 'SCAN_FAILED');
      if (hasCode(error, 'UNSAFE_PATH')) throw new ModContractError('MODS_UNSAFE');
      if (hasCode(error, 'ENOENT')) throw new ModContractError('FILES_CHANGED');
      throw error;
    } finally { this.active = false; }
  }
}
