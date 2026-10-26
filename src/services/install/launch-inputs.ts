import { lstat, readlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { RecordEnvelope } from '../storage/records.js';
import type { InstanceRecord } from '../storage/instance-records.js';
import type { PreparedInstallMetadata } from '../catalog/install-metadata.js';
import type { HashPool } from '../workers/hash-pool.js';
import type { NativeExtractor } from '../workers/native-extractor.js';
import type { FileViewService } from './file-views.js';
import { guardDirectory, readRegular } from '../storage/files.js';
import { instanceGameLayout, prepareInstanceNatives, viewTarget } from './instance-files.js';
import { artifactSpec } from './metadata-object.js';
import { GameProcessError } from '../launch/process.js';
import { verifyProcessorOutputs } from '../loaders/processor-outputs.js';

interface Runtime { dataDirectory: string; rootId: string; hashes: HashPool; extractor: NativeExtractor; views: FileViewService }
/** Reuses the installer's object owner/hash pool, verifying published launch dependencies without opening a second store. */
export async function verifyLaunchInputs(runtime: Runtime, record: RecordEnvelope<InstanceRecord>, prepared: PreparedInstallMetadata, signal: AbortSignal) {
  const check = (): void => { if (signal.aborted) throw new GameProcessError('CANCELLED'); }; check();
  const layout = instanceGameLayout(runtime.dataDirectory, record.data.summary, prepared);
  await guardDirectory(layout.gameDirectory); await guardDirectory(layout.versionDirectory); await guardDirectory(layout.nativesDirectory);
  const body = await readRegular(layout.instanceJson);
  if (!body || !isDeepStrictEqual(JSON.parse(body.toString('utf8')) as unknown, record)) throw new GameProcessError('NEEDS_RECOVERY');
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
    await runtime.views.materialize(target.directory, target.relative, artifactSpec(artifact), object, { mode: 'prefer-link', signal, existing: {
      relativePath: target.relative, mode: receipt.mode, objectDigest: object.digest, size: object.size } });
  }
  const archives = prepared.plan.natives.map(native => {
    const object = record.data.objects?.[native.artifactId]; if (!object) throw new GameProcessError('NEEDS_RECOVERY');
    return { file: path.join(layout.storeDirectory, 'objects', 'sha256', object.digest.slice(0, 2), object.digest), sha256: object.digest, size: object.size, exclude: native.exclude };
  });
  await prepareInstanceNatives(layout.versionDirectory, archives, runtime.extractor, runtime.hashes, signal); check();
  return { layout, prepared };
}
