import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { RecordStore } from '../storage/records.js';
import { guardDirectory, StorageError } from '../storage/files.js';
import { parseStorageRequest, WorkerError } from './protocol.js';
import { readModTargets } from './mod-targets.js';
import type { WorkerCode, WorkerReply } from './protocol.js';
import { ObjectIndex } from '../storage/object-index.js';
import { parseInstallation } from '../storage/installation.js';
import { parseCatalogCache } from '../storage/catalog-cache.js';
import { TransferDatabase } from '../storage/transfer-db.js';
import { digestFile, startHashSession } from './hash-session.js';
import { extractNativeArchives, extractSelectedArchive, NativeArchiveError, readVerifiedArchiveEntry, validateVerifiedArchive } from '../install/native-archive.js';
import { parseNativeRequest } from './native-protocol.js';
import { INSTALLER_ENTRIES, parseInstallerArchiveRequest } from './installer-archive-protocol.js';
import { parseProcessorManifestRequest } from './processor-manifest-protocol.js';
import { parseProcessorMainClass } from '../../core/loaders/processor-manifest.js';
import { parseArchiveValidationRequest } from './archive-validation-protocol.js';
import { instanceRecordId, parseInstanceIndex, parseInstanceRecord } from '../storage/instance-records.js';
import { parseLaunchProfiles } from '../storage/launch-profiles.js';
import { parseResourceLibrary } from '../storage/resources.js';
import { parseDesktop } from '../storage/desktop.js';
import { parseSettings } from '../storage/settings.js';
import { parseGameSessions } from '../storage/game-sessions.js';
import { ModArchiveError, scanModArchive } from '../mods/archive.js';
import { parseModArchiveRequest } from './mod-archive-protocol.js';
import { modReportRecordId, parseModJobs, parseStoredModReport } from '../storage/mod-jobs.js';
import { assertModPlanTransition, modPlanRecordId, parseStoredModPlan } from '../storage/mod-plans.js';
import { modConfirmationDigest } from '../mods/plan-identity.js';
import { assertModResultTransition, modResultRecordId, parseModInstallResult } from '../storage/mod-results.js';
import { assertModTransactionTransition, modTransactionRecordId, parseModTransaction } from '../storage/mod-transactions.js';

const port = parentPort;
if (!port) throw new WorkerError('INVALID_MESSAGE');
const send = (value: WorkerReply): void => { port.postMessage(value); };
const code = (error: unknown): WorkerCode => error instanceof StorageError || error instanceof WorkerError ? error.code : 'WORKER_FAILED';

async function storage(directory: string, ownerToken?: string): Promise<void> {
  const store = await RecordStore.open(directory, ownerToken);
  try { await store.recover(); } catch (error) { await store.close(); throw error; }
  let index: ObjectIndex | undefined;
  let transfers: TransferDatabase | undefined;
  let tail = Promise.resolve();
  let closing = false;
  port!.on('message', (input: unknown) => {
    tail = tail.then(async () => {
      let request;
      try { request = parseStorageRequest(input); }
      catch { send({ version: 1, kind: 'startup-failed', code: 'INVALID_MESSAGE' }); transfers?.close(); index?.close(); await store.close(); port!.close(); return; }
      if (closing) return;
      try {
        const command = request.command;
        let task;
        let object;
        let installation;
        let catalog;
        let transfer;
        let instances;
        let instance;
        let profiles;
        let sessions;
        let settings; let desktop;
        let resources;
        let modJobs;
        let modReport;
        let modPlan;
        let modTransaction;
        let modConfirmations;
        let modTargets;
        let modResult;
        let distributionProjections;
        if (command.kind === 'accept') task = await store.acceptTask(command.ownerId, command.requestId, command.taskKind, command.payloadDigest);
        else if (command.kind === 'find-accepted') task = await store.findAcceptedTask(command.ownerId, command.requestId, command.taskKind, command.payloadDigest);
        else if (command.kind === 'distribution-task:list') {
          const root = await store.read('installation', parseInstallation);
          if (!root || command.expectedRootId !== root.data.rootId.toLowerCase()) throw new WorkerError('NEEDS_RECOVERY');
          distributionProjections = await store.readDistributionTaskProjections(root.data.rootId.toLowerCase());
        }
        else if (command.kind === 'distribution-task:project') {
          const root = await store.read('installation', parseInstallation);
          if (!root) throw new WorkerError('INVALID_RECORD');
          if (command.expectedRootId !== root.data.rootId.toLowerCase()) throw new WorkerError('NEEDS_RECOVERY');
          task = await store.projectDistributionTask(root.data.rootId.toLowerCase(), command.proposalId, command.payloadDigest, command.taskId);
        }
        else if (command.kind === 'mod-targets:read') modTargets = await readModTargets(store, command);
        else if (command.kind === 'mod-confirm:accept' || command.kind === 'mod-confirm:list') {
          const root = await store.read('installation', parseInstallation);
          if (!root) throw new WorkerError('INVALID_RECORD');
          const ownerId = root.data.rootId;
          if (command.kind === 'mod-confirm:list') {
            modConfirmations = await store.readModConfirmations(ownerId);
            for (const confirmation of modConfirmations) {
              const plan = await store.read(modPlanRecordId(confirmation.planRequestId), parseStoredModPlan);
              if (!plan || plan.data.rootId !== ownerId || plan.data.requestId !== confirmation.planRequestId
                || plan.data.status !== 'preview' || plan.data.plan.state !== 'ready'
                || confirmation.payloadDigest !== modConfirmationDigest(confirmation.planRequestId, plan.data.plan.planId)) throw new WorkerError('NEEDS_RECOVERY');
            }
          } else {
            const id = command.planRequestId.toLowerCase();
            const plan = await store.read(modPlanRecordId(id), parseStoredModPlan);
            if (!plan || plan.data.rootId !== ownerId || plan.data.requestId !== id || plan.data.plan.planId !== command.planId) throw new WorkerError('REVISION_CONFLICT');
            if (plan.data.status === 'cancelled') throw new WorkerError('CANCELLED');
            if (plan.revision !== 1 || plan.data.plan.state !== 'ready') throw new WorkerError('INVALID_RECORD');
            const digest = modConfirmationDigest(id, command.planId);
            task = await store.findAcceptedTask(ownerId, id, 'mod-install', digest);
            if (!task) {
              const instance = await store.read(instanceRecordId(plan.data.plan.instanceId), parseInstanceRecord);
              if (!instance || instance.data.summary.rootId !== ownerId || instance.data.phase !== 'ready'
                || instance.revision !== plan.data.plan.instanceRevision || !instance.data.loader || instance.data.loader.kind === 'vanilla'
                || instance.data.loader.kind !== plan.data.plan.loader || instance.data.summary.mcVersionId !== plan.data.plan.minecraft) throw new WorkerError('REVISION_CONFLICT');
              if ((await store.readModConfirmations(ownerId)).length >= 1000) throw new WorkerError('QUEUE_FULL');
              task = await store.acceptTask(ownerId, id, 'mod-install', digest);
            }
          }
        }
        else if (command.kind === 'mod-result:get' || command.kind === 'mod-result:set') {
          const id = modResultRecordId(command.taskId); const previous = await store.read(id, parseModInstallResult);
          if (previous && previous.data.taskId !== command.taskId.toLowerCase()) throw new WorkerError('INVALID_RECORD');
          if (command.kind === 'mod-result:get') modResult = previous;
          else {
            const data = command.data; const plan = await store.read(modPlanRecordId(data.planRequestId), parseStoredModPlan);
            if (!plan || plan.data.rootId !== data.rootId || plan.data.plan.planId !== data.planId
              || plan.data.plan.instanceId !== data.instanceId || plan.data.plan.instanceRevision !== data.instanceRevision
              || data.assessment && (data.assessment.fingerprint !== plan.data.plan.fingerprint || data.assessment.mode !== 'check')
              || (await store.getTask(data.rootId, data.taskId))?.kind !== 'mod-install') throw new WorkerError('INVALID_RECORD');
            const accepted = await store.findAcceptedTask(data.rootId, data.planRequestId, 'mod-install', modConfirmationDigest(data.planRequestId, data.planId));
            if (accepted?.taskId !== data.taskId) throw new WorkerError('INVALID_RECORD');
            assertModResultTransition(previous?.data, data); modResult = await store.write(id, command.expectedRevision, data, parseModInstallResult);
          }
        }
        else if (command.kind === 'mod-jobs:get') modJobs = await store.read('mod-jobs', parseModJobs);
        else if (command.kind === 'mod-jobs:set') modJobs = await store.write('mod-jobs', command.expectedRevision, command.data, parseModJobs);
        else if (command.kind === 'mod-txn:get' || command.kind === 'mod-txn:set') {
          const recordId = modTransactionRecordId(command.taskId); const previous = await store.read(recordId, parseModTransaction);
          if (previous && previous.data.taskId.toLowerCase() !== command.taskId.toLowerCase()) throw new StorageError('INVALID_RECORD');
          if (command.kind === 'mod-txn:get') modTransaction = previous;
          else {
            assertModTransactionTransition(previous?.data, command.data);
            modTransaction = await store.write(recordId, command.expectedRevision, command.data, parseModTransaction);
          }
        }
        else if (command.kind === 'mod-plan:get' || command.kind === 'mod-plan:set') {
          const recordId = modPlanRecordId(command.requestId);
          const previous = await store.read(recordId, parseStoredModPlan);
          if (previous && (previous.data.requestId !== command.requestId.toLowerCase()
            || previous.revision !== (previous.data.status === 'preview' ? 1 : 2))) throw new StorageError('INVALID_RECORD');
          if (command.kind === 'mod-plan:get') modPlan = previous;
          else {
            assertModPlanTransition(previous?.data, command.data);
            if (command.data.status === 'cancelled' && await store.findAcceptedTask(command.data.rootId, command.data.requestId,
              'mod-install', modConfirmationDigest(command.data.requestId, command.data.plan.planId))) throw new WorkerError('CANCEL_TOO_LATE');
            modPlan = await store.write(recordId, command.expectedRevision, command.data, parseStoredModPlan);
          }
        }
        else if (command.kind === 'mod-report:get') {
          modReport = await store.read(modReportRecordId(command.taskId), parseStoredModReport);
          if (modReport && modReport.data.taskId.toLowerCase() !== command.taskId.toLowerCase()) throw new StorageError('NEEDS_RECOVERY');
        }
        else if (command.kind === 'mod-report:set') modReport = await store.write(modReportRecordId(command.taskId), 0, command.data, parseStoredModReport);
        else if (command.kind === 'get') task = await store.getTask(command.ownerId, command.taskId);
        else if (command.kind === 'update') task = await store.updateTask(command.ownerId, command.taskId, command.expectedRevision, command.execution);
        else if (command.kind === 'resources:get') resources = await store.read('resource-library', parseResourceLibrary);
        else if (command.kind === 'resources:set') resources = await store.write('resource-library', command.expectedRevision, command.data, parseResourceLibrary);
        else if (command.kind === 'desktop:get') desktop = await store.read('desktop', parseDesktop);
        else if (command.kind === 'desktop:set') desktop = await store.write('desktop', command.expectedRevision, command.data, parseDesktop);
        else if (command.kind === 'settings:get') settings = await store.read('launch-settings', parseSettings);
        else if (command.kind === 'settings:set') settings = await store.write('launch-settings', command.expectedRevision, command.data, parseSettings);
        else if (command.kind === 'sessions:get') sessions = await store.read('game-sessions', parseGameSessions);
        else if (command.kind === 'sessions:set') sessions = await store.write('game-sessions', command.expectedRevision, command.data, parseGameSessions);
        else if (command.kind === 'profiles:get') profiles = await store.read('launch-profiles', parseLaunchProfiles);
        else if (command.kind === 'profiles:set') profiles = await store.write('launch-profiles', command.expectedRevision, command.data, parseLaunchProfiles);
        else if (command.kind === 'installation:get') installation = await store.read('installation', parseInstallation);
        else if (command.kind === 'installation:set') installation = await store.write('installation', 0, command.data, parseInstallation);
        else if (command.kind === 'catalog:get') catalog = await store.read('catalog', parseCatalogCache);
        else if (command.kind === 'catalog:set') catalog = await store.write('catalog', command.expectedRevision, command.data, parseCatalogCache);
        else if (command.kind === 'instances:get') instances = await store.read('instances', parseInstanceIndex);
        else if (command.kind === 'instances:set') instances = await store.write('instances', command.expectedRevision, command.data, parseInstanceIndex);
        else if (command.kind === 'instance:get') {
          instance = await store.read(instanceRecordId(command.instanceId), parseInstanceRecord);
          if (instance && (instance.data.summary.instanceId !== command.instanceId.toLowerCase() || instance.data.summary.revision !== instance.revision)) throw new StorageError('NEEDS_RECOVERY');
        }
        else if (command.kind === 'instance:set') instance = await store.write(instanceRecordId(command.instanceId), command.expectedRevision, command.data, parseInstanceRecord);
        else if (command.kind === 'transfer:get' || command.kind === 'transfer:set') {
          await guardDirectory(directory); transfers ??= await TransferDatabase.open(directory, store);
          if (command.kind === 'transfer:get') transfer = transfers.get(command.key);
          else transfers.set(command.expectedRevision, command.record);
        }
        else if (command.kind === 'object:lookup' || command.kind === 'object:remember' || command.kind === 'object:clear') {
          await guardDirectory(directory);
          index ??= await ObjectIndex.open(directory);
          if (command.kind === 'object:lookup') object = index.lookup(command.sourceKey);
          else if (command.kind === 'object:remember') index.remember(command.sourceKey, command.object);
          else index.clear();
        } else { closing = true; transfers?.close(); index?.close(); await store.close(); }
        send({ version: 1, kind: 'response', id: request.id, ok: true, ...(task === undefined ? {} : { task }), ...(object === undefined ? {} : { object }),
          ...(installation === undefined ? {} : { installation }), ...(catalog === undefined ? {} : { catalog }), ...(transfer === undefined ? {} : { transfer }),
          ...(instances === undefined ? {} : { instances }), ...(instance === undefined ? {} : { instance }), ...(profiles === undefined ? {} : { profiles }), ...(sessions === undefined ? {} : { sessions }), ...(settings === undefined ? {} : { settings }), ...(desktop === undefined ? {} : { desktop }), ...(resources === undefined ? {} : { resources }), ...(modJobs === undefined ? {} : { modJobs }), ...(modReport === undefined ? {} : { modReport }), ...(modPlan === undefined ? {} : { modPlan }), ...(modTransaction === undefined ? {} : { modTransaction }), ...(distributionProjections === undefined ? {} : { distributionProjections }), ...(modConfirmations === undefined ? {} : { modConfirmations }), ...(modResult === undefined ? {} : { modResult }), ...(modTargets === undefined ? {} : { modTargets }) });
        if (closing) port!.close();
      } catch (error) { send({ version: 1, kind: 'response', id: request.id, ok: false, code: code(error) }); }
    }).catch(() => { send({ version: 1, kind: 'startup-failed', code: 'WORKER_FAILED' }); port!.close(); });
  });
  send({ version: 1, kind: 'ready', features: ['mod-targets.read.v1'] });
}

async function hashFile(file: string, maximumBytes: number): Promise<void> {
  const result = await digestFile(file, maximumBytes, (bytesDone, bytesTotal) => { send({ version: 1, kind: 'hash-progress', bytesDone, bytesTotal }); });
  send({ version: 1, kind: 'hash-result', result });
  port!.close();
}

void (async () => {
  const input: unknown = workerData;
  if (typeof input !== 'object' || input === null || !('version' in input) || input.version !== 1 || !('kind' in input)) throw new WorkerError('INVALID_MESSAGE');
  if (input.kind === 'mod-archive') {
    try {
      const request = parseModArchiveRequest(input);
      port.postMessage({ version: 1, kind: 'mod-archive-result', result: await scanModArchive(request.file) });
    } catch (error) { port.postMessage({ version: 1, kind: 'mod-archive-failed', code: error instanceof ModArchiveError ? error.code : 'INVALID_ARCHIVE' }); }
    port.close();
  }
  else if (input.kind === 'native-extract') {
    try {
      let request;
      try { request = parseNativeRequest(input); } catch { throw new NativeArchiveError('INVALID_ARCHIVE'); }
      const result = await extractNativeArchives(request.destination, request.archives);
      port.postMessage({ version: 1, kind: 'native-result', ...result });
    } catch (error) { port.postMessage({ version: 1, kind: 'native-failed', code: error instanceof NativeArchiveError ? error.code : 'ARCHIVE_IO' }); }
    port.close();
  }
  else if (input.kind === 'loader-installer-extract') {
    try {
      let request;
      try { request = parseInstallerArchiveRequest(input); } catch { throw new NativeArchiveError('INVALID_ARCHIVE'); }
      const result = await extractSelectedArchive(request.destination, request, INSTALLER_ENTRIES);
      if (result.files !== 3) throw new NativeArchiveError('INVALID_ARCHIVE');
      port.postMessage({ version: 1, kind: 'loader-installer-result', files: 3, bytes: result.bytes });
    } catch (error) { port.postMessage({ version: 1, kind: 'loader-installer-failed', code: error instanceof NativeArchiveError ? error.code : 'ARCHIVE_IO' }); }
    port.close();
  }
  else if (input.kind === 'processor-manifest') {
    try {
      let request;
      try { request = parseProcessorManifestRequest(input); } catch { throw new NativeArchiveError('INVALID_ARCHIVE'); }
      const body = await readVerifiedArchiveEntry(request, 'META-INF/MANIFEST.MF', 64 * 1024);
      port.postMessage({ version: 1, kind: 'processor-manifest-result', mainClass: parseProcessorMainClass(body) });
    } catch (error) { port.postMessage({ version: 1, kind: 'processor-manifest-failed', code: error instanceof NativeArchiveError ? error.code : 'INVALID_ARCHIVE' }); }
    port.close();
  }
  else if (input.kind === 'processor-output-validate') {
    try {
      let request;
      try { request = parseArchiveValidationRequest(input); } catch { throw new NativeArchiveError('INVALID_ARCHIVE'); }
      const result = await validateVerifiedArchive(request);
      port.postMessage({ version: 1, kind: 'processor-output-valid', ...result });
    } catch (error) { port.postMessage({ version: 1, kind: 'processor-output-invalid', code: error instanceof NativeArchiveError ? error.code : 'ARCHIVE_IO' }); }
    port.close();
  }
  else if (input.kind === 'storage' && Object.keys(input).sort().join(',') === 'directory,kind,version'
    && 'directory' in input && typeof input.directory === 'string') await storage(input.directory);
  else if (input.kind === 'storage' && Object.keys(input).sort().join(',') === 'directory,kind,ownerToken,version'
    && 'directory' in input && typeof input.directory === 'string' && 'ownerToken' in input
    && typeof input.ownerToken === 'string' && /^oucl-owner-v2:[a-f0-9-]{36}:\d+:\d+$/.test(input.ownerToken)) await storage(input.directory, input.ownerToken);
  else if (input.kind === 'hash-session' && Object.keys(input).sort().join(',') === 'kind,version') startHashSession(port);
  else if (input.kind === 'hash' && Object.keys(input).sort().join(',') === 'file,kind,maximumBytes,version'
    && 'file' in input && typeof input.file === 'string' && path.isAbsolute(input.file)
    && 'maximumBytes' in input && typeof input.maximumBytes === 'number' && Number.isSafeInteger(input.maximumBytes)
    && input.maximumBytes >= 0 && input.maximumBytes <= 64 * 1024 ** 3) await hashFile(input.file, input.maximumBytes);
  else throw new WorkerError('INVALID_MESSAGE');
})().catch(error => { send({ version: 1, kind: 'startup-failed', code: code(error) }); port.close(); });
