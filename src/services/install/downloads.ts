import { randomUUID } from 'node:crypto';
import { parseAssetIndex } from '../../core/install/assets.js';
import { planVanillaInstall } from '../../core/install/plan.js';
import type { PlannedArtifact, VanillaInstallPlan } from '../../core/install/plan.js';
import type { PreparedInstallMetadata } from '../catalog/install-metadata.js';
import type { PreparedLoaderMetadata } from '../loaders/install-metadata.js';
import { rebuildPreparedLoaderPlan } from '../loaders/install-metadata.js';
import { rebuildPreparedInstallerPlan } from '../loaders/installer-install-metadata.js';
import type { PreparedInstallerMetadata } from '../loaders/installer-install-metadata.js';
import type { DownloadCoordinator } from '../download/coordinator.js';
import { CoordinatorError } from '../download/coordinator.js';
import { DownloadError } from '../download/types.js';
import type { ObjectStore, ObjectRef } from '../objects/store.js';
import { artifactSpec, importAssetIndex } from './metadata-object.js';

export interface InstallDownloadProgress {
  totalArtifacts: number; completedArtifacts: number; totalBytes: number; verifiedBytes: number;
}
export interface DownloadedInstall { plan: VanillaInstallPlan; objects: ReadonlyMap<string, ObjectRef> }
type InstallObjects = Pick<ObjectStore, 'lookup' | 'createStaging' | 'commit' | 'discardStaging' | 'adopt'>;
function installerMetadata(value: PreparedInstallMetadata | PreparedLoaderMetadata | PreparedInstallerMetadata): value is PreparedInstallerMetadata {
  return 'loader' in value && (value.loader.kind === 'forge' || value.loader.kind === 'neoforge');
}

/** Executes bounded live installation downloads; durable installation/task associations belong to the task service. */
export class InstallDownloadService {
  constructor(private readonly downloads: Pick<DownloadCoordinator, 'request'>, private readonly objects: InstallObjects,
    private readonly concurrency = 4) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new DownloadError('INVALID_TRANSFER');
  }

  /** Returns only after every artifact and independent proof is committed, or all owned consumers have joined. */
  async run(metadata: PreparedInstallMetadata | PreparedLoaderMetadata | PreparedInstallerMetadata, options: { signal?: AbortSignal; onProgress?: (value: InstallDownloadProgress) => void; consumerId?: (artifactId: string) => string } = {}): Promise<DownloadedInstall> {
    const controller = new AbortController(); const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      // Rebuild a private plan instead of trusting a caller-mutated plan or resource list across awaits.
      const body = metadata.assetIndexBody;
      let rawAssets: unknown;
      try { rawAssets = JSON.parse(body) as unknown; } catch { throw new DownloadError('INVALID_TRANSFER'); }
      const plan = installerMetadata(metadata) ? rebuildPreparedInstallerPlan({ ...metadata, assets: parseAssetIndex(rawAssets) })
        : 'loader' in metadata ? rebuildPreparedLoaderPlan({ ...metadata, assets: parseAssetIndex(rawAssets) })
        : planVanillaInstall(metadata.version, metadata.metadataSha1ByVersion, parseAssetIndex(rawAssets));
      const index = metadata.version.assetIndex;
      const indexView = plan.views.find(view => view.area === 'assets' && view.path === `indexes/${index?.id}.json`);
      const indexArtifact = plan.artifacts.find(artifact => artifact.artifactId === indexView?.artifactId);
      if (!indexArtifact || indexArtifact.sha1 !== index?.sha1 || indexArtifact.size !== index.size) throw new DownloadError('INVALID_TRANSFER');
      const objects = new Map<string, ObjectRef>(); let verifiedBytes = 0;
      const progress = (): void => {
        try { options.onProgress?.({ totalArtifacts: plan.artifacts.length, completedArtifacts: objects.size, totalBytes: plan.totalBytes, verifiedBytes }); }
        catch { throw new CoordinatorError('CALLBACK_FAILED'); }
      };
      const cancelled = (): void => { if (controller.signal.aborted) throw new DownloadError('CANCELLED'); };
      const complete = async (artifact: PlannedArtifact, object: ObjectRef): Promise<void> => {
        for (const proof of artifact.proofs.slice(1)) {
          cancelled(); const spec = artifactSpec(artifact, proof);
          await this.objects.adopt(object.digest, spec.expected, spec.anchor);
        }
        cancelled(); objects.set(artifact.artifactId, object); verifiedBytes += artifact.size; progress();
      };
      cancelled(); progress();
      await complete(indexArtifact, await importAssetIndex(this.objects, indexArtifact, body, controller.signal));
      const queue = plan.artifacts.filter(artifact => artifact !== indexArtifact); let next = 0;
      const failures: unknown[] = [];
      const lane = async (): Promise<void> => {
        try {
          while (next < queue.length) {
            cancelled(); const artifact = queue[next++]!;
            const consumer = this.downloads.request(artifactSpec(artifact), { consumerId: options.consumerId?.(artifact.artifactId) ?? randomUUID(), signal: controller.signal });
            // The consumer result settles only after its physical/proof cleanup; other installations remain independent.
            await complete(artifact, await consumer.result);
          }
        } catch (error) { failures.push(error); controller.abort(); }
      };
      await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, lane));
      const failure = failures.find(error => !(error instanceof DownloadError && error.code === 'CANCELLED')) ?? failures[0];
      if (failure !== undefined) throw failure;
      cancelled(); return { plan, objects };
    } finally { options.signal?.removeEventListener('abort', abort); }
  }
}
