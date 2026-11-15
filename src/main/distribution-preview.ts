import { DistributionPreviewAdapter } from '../ipc/distribution-preview.js';
import type { DistributionSummary } from '../shared/contracts/distribution-preview.js';
import { DistributionPreviewService, DistributionPreviewError } from '../services/distribution/preview.js';
import { EMPTY_DISTRIBUTION_SOURCES } from '../services/distribution/source.js';
import { restoreInstallMetadata } from '../services/install/installer.js';
import { instanceGameLayout } from '../services/install/instance-files.js';
import type { StorageClient } from '../services/workers/storage-client.js';

/** Bound to the registered root on both target reads. No renderer-provided path or environment is used. */
export function createDistributionPreviewAdapter(storage: Pick<StorageClient, 'readInstallation' | 'readInstance'>, fetcher: typeof fetch): DistributionPreviewAdapter {
  let active = false;
  return new DistributionPreviewAdapter({
    listSources: () => EMPTY_DISTRIBUTION_SOURCES.map(source => ({ sourceId: source.sourceId })),
    async preview(query, signal): Promise<DistributionSummary> {
      if (active) throw new DistributionPreviewError('PREVIEW_BUSY'); active = true;
      try {
        const service = new DistributionPreviewService({ sources: EMPTY_DISTRIBUTION_SOURCES, fetcher,
          readTarget: async instanceId => {
            if (signal.aborted) throw new DistributionPreviewError('CANCELLED');
            const root = await storage.readInstallation(); const record = await storage.readInstance(instanceId);
            if (!root || root.data.rootId !== query.rootId || !record || record.data.phase !== 'ready' || record.data.summary.rootId !== root.data.rootId) throw new DistributionPreviewError('TARGET_MISMATCH');
            const metadata = restoreInstallMetadata(record.data); const loader = record.data.loader ?? { kind: 'vanilla' as const };
            const major = metadata.version.javaMajor;
            if (major !== 8 && major !== 17 && major !== 21) throw new DistributionPreviewError('TARGET_MISMATCH');
            return { instanceId, revision: record.revision, gameDir: instanceGameLayout(root.data.dataDirectory, record.data.summary, metadata).gameDirectory,
              environment: { minecraft: record.data.summary.mcVersionId, javaMajor: major, loader: loader.kind, loaderVersion: loader.kind === 'vanilla' ? null : loader.version } };
          } });
        const value = await service.preview(query, signal);
        return { sourceId: value.sourceId, instanceId: value.instanceId, revision: value.revision, packageId: value.manifest.packageId, packageVersion: value.manifest.packageVersion,
          readOnly: true, receiptStatus: value.receiptStatus, totalFiles: value.ownership.length, truncated: value.ownership.length > 200,
          ownership: value.ownership.slice(0, 200).map(({ area, path, ownership }) => ({ area, path, ownership })),
          changes: value.diff.changes.filter(operation => operation.kind !== 'keep').map(({ area, path, kind }) => ({ area, path, kind: kind as 'add' | 'replace' | 'remove' })),
          conflicts: value.diff.conflicts };
      } finally { active = false; }
    },
  });
}
