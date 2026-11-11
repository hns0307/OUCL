import { lstat, readlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { exactObject } from '../../shared/contracts/handshake.js';
import type { RecordEnvelope } from '../storage/records.js';
import type { InstanceRecord } from '../storage/instance-records.js';
import { parseInstanceRecord } from '../storage/instance-records.js';
import type { ModTransaction } from '../storage/mod-transactions.js';
import type { PreparedInstallMetadata } from '../catalog/install-metadata.js';
import type { HashPool } from '../workers/hash-pool.js';
import type { NativeExtractor } from '../workers/native-extractor.js';
import type { FileViewService } from './file-views.js';
import { guardDirectory, readRegular } from '../storage/files.js';
import { ensureChildDirectory, instanceGameLayout, prepareInstanceNatives, viewTarget } from './instance-files.js';
import { artifactSpec } from './metadata-object.js';
import { GameProcessError } from '../launch/process.js';
import { verifyProcessorOutputs } from '../loaders/processor-outputs.js';
import { readNativeSnapshot } from './launch-snapshot.js';
import type { NativeFileFact } from './launch-snapshot.js';

interface Runtime { dataDirectory: string; rootId: string; hashes: HashPool; extractor: NativeExtractor; views: FileViewService }
/** Accept only the unchanged installation projection backed by a committed Mod transaction. */
export function matchesLaunchProjection(value: unknown, record: RecordEnvelope<InstanceRecord>, transaction?: ModTransaction): boolean {
  if (isDeepStrictEqual(value, record)) return true;
  if (!transaction || transaction.phase !== 'committed' || transaction.taskId !== record.data.modCommitId
    || transaction.instanceId !== record.data.summary.instanceId || transaction.rootId !== record.data.summary.rootId
    || transaction.instanceRevision + 1 !== record.revision || record.data.summary.revision !== record.revision
    || createHash('sha256').update(JSON.stringify(record.data)).digest('hex') !== transaction.afterInstanceDigest
    || !exactObject(value, ['schemaVersion', 'revision', 'data']) || value.schemaVersion !== 1
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > transaction.instanceRevision) return false;
  try {
    const projected = parseInstanceRecord(value.data);
    if (projected.summary.revision !== value.revision) return false;
    const oldData = structuredClone(projected); delete oldData.modCommitId;
    const newData = structuredClone(record.data); delete newData.modCommitId;
    return isDeepStrictEqual({ ...oldData, summary: { ...oldData.summary, revision: 0 } },
      { ...newData, summary: { ...newData.summary, revision: 0 } });
  } catch { return false; }
}
/** Reuses the installer's object owner/hash pool, verifying published launch dependencies without opening a second store. */
export async function verifyLaunchInputs(runtime: Runtime, record: RecordEnvelope<InstanceRecord>, prepared: PreparedInstallMetadata, signal: AbortSignal, transaction?: ModTransaction, nativeBaseline?: readonly NativeFileFact[]) {
  const check = (): void => { if (signal.aborted) throw new GameProcessError('CANCELLED'); }; check();
  const layout = instanceGameLayout(runtime.dataDirectory, record.data.summary, prepared);
  await guardDirectory(layout.gameDirectory); await guardDirectory(layout.versionDirectory);
  const body = await readRegular(layout.instanceJson);
  if (!body || !matchesLaunchProjection(JSON.parse(body.toString('utf8')) as unknown, record, transaction)) throw new GameProcessError('NEEDS_RECOVERY');
  const projection = async (area: 'assets' | 'libraries'): Promise<string> => {
    const file = path.join(layout.gameRoot, area); const entry = await lstat(file);
    if (!entry.isSymbolicLink()) return guardDirectory(file);
    const expected = await guardDirectory(path.join(layout.storeDirectory, 'views', runtime.rootId, area));
    if (await guardDirectory(path.resolve(layout.gameRoot, await readlink(file))) !== expected) throw new GameProcessError('NEEDS_RECOVERY');
    return expected;
  };
  const directories = { layout, assets: await projection('assets'), libraries: await projection('libraries') };
  const loader = record.data.metadata?.loader;
  if (loader?.kind === 'forge' || loader?.kind === 'neoforge') {
    if (!loader.processors) throw new GameProcessError('NEEDS_RECOVERY');
    await verifyProcessorOutputs(directories.libraries, loader.processors, runtime.hashes, signal); check();
  }
  const required = prepared.plan.views.filter(view => view.area !== 'assets' || view.path.startsWith('indexes/'));
  for (const view of required) {
    check();
    const receipt = record.data.receipts?.find(item => item.area === view.area && item.path === view.path && item.artifactId === view.artifactId);
    const artifact = prepared.plan.artifacts.find(item => item.artifactId === view.artifactId); const object = record.data.objects?.[view.artifactId];
    if (!receipt || !artifact || !object) throw new GameProcessError('NEEDS_RECOVERY');
    const target = viewTarget(directories, view); await lstat(path.join(target.directory, target.relative));
    if (nativeBaseline) {
      const file = path.join(target.directory, target.relative); const entry = await lstat(file);
      const source = path.join(layout.storeDirectory, 'objects', 'sha256', object.digest.slice(0, 2), object.digest);
      await guardDirectory(path.dirname(file));
      if (receipt.mode === 'symlink') {
        if (!entry.isSymbolicLink() || path.resolve(path.dirname(file), await readlink(file)) !== source) throw new GameProcessError('NEEDS_RECOVERY');
        await guardDirectory(path.dirname(source));
        const origin = await lstat(source); if (!origin.isFile() || origin.isSymbolicLink()) throw new GameProcessError('NEEDS_RECOVERY');
      } else if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new GameProcessError('NEEDS_RECOVERY');
      const measured = await runtime.hashes.hash(receipt.mode === 'symlink' ? source : file, { maximumBytes: object.size, signal });
      if (measured.size !== object.size || measured.sha256 !== object.digest) throw new GameProcessError('NEEDS_RECOVERY');
    } else {
      await runtime.views.materialize(target.directory, target.relative, artifactSpec(artifact), object, { mode: 'prefer-link', signal, existing: {
        relativePath: target.relative, mode: receipt.mode, objectDigest: object.digest, size: object.size } });
    }
  }
  const archives = prepared.plan.natives.map(native => {
    const object = record.data.objects?.[native.artifactId]; if (!object) throw new GameProcessError('NEEDS_RECOVERY');
    return { file: path.join(layout.storeDirectory, 'objects', 'sha256', object.digest.slice(0, 2), object.digest), sha256: object.digest, size: object.size, exclude: native.exclude };
  });
  if (!nativeBaseline) {
    await prepareInstanceNatives(layout.versionDirectory, archives, runtime.extractor, runtime.hashes, signal); check();
    await ensureChildDirectory(layout.versionDirectory, '.oucl-launch', 'jna'); check();
    await ensureChildDirectory(layout.versionDirectory, '.oucl-launch', 'native-cache'); check();
  } else {
    await guardDirectory(path.join(layout.versionDirectory, '.oucl-launch', 'jna'));
    await guardDirectory(path.join(layout.versionDirectory, '.oucl-launch', 'native-cache'));
  }
  const nativeFiles = await readNativeSnapshot(path.join(layout.versionDirectory, 'natives'), runtime.hashes, signal); check();
  if (nativeBaseline && !isDeepStrictEqual(nativeFiles, nativeBaseline)) throw new GameProcessError('NEEDS_RECOVERY');
  return { layout, prepared, nativeFiles };
}
