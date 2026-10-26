import path from 'node:path';
import type { PreparedInstallerMetadata } from './installer-install-metadata.js';
import type { DownloadedInstall } from '../install/downloads.js';
import type { FileViewService } from '../install/file-views.js';
import type { DownloadCoordinator } from '../download/coordinator.js';
import type { HashPool } from '../workers/hash-pool.js';
import { ProcessorManifestReader } from '../workers/processor-manifest-reader.js';
import { ProcessorArchiveValidator } from '../workers/archive-validator.js';
import { JavaProbe } from '../java/probe.js';
import { InstallerProcessorExecutor } from './processor-executor.js';
import { prepareMojangMappings, prepareProcessorWorkspace } from './processor-workspace.js';
import type { PersistedProcessorEvidence } from '../storage/instance-records.js';
import { parseStoredInstallerProfile } from './installer-compose.js';

interface ProcessingRuntime {
  views: Pick<FileViewService, 'materialize'>; coordinator: Pick<DownloadCoordinator, 'request'>; hashes: Pick<HashPool, 'hash'>;
}

/** Runs the authenticated client chain and returns relative, independently verifiable output evidence. */
export async function processInstallerWorkspace(metadata: PreparedInstallerMetadata, downloaded: DownloadedInstall, workspace: string,
  executable: string, mappingConsumerId: string, entry: string | URL, runtime: ProcessingRuntime, signal: AbortSignal): Promise<PersistedProcessorEvidence[]> {
  const plan = await prepareProcessorWorkspace(metadata, downloaded, workspace, runtime.views, new ProcessorManifestReader(entry), signal);
  const validator = new ProcessorArchiveValidator(entry);
  const executor = new InstallerProcessorExecutor({ probe: new JavaProbe(), hash: runtime.hashes,
    validateArchive: (file, sha256, size, cancellation) => validator.validate(file, sha256, size, cancellation),
    prepareMojangMappings: prepareMojangMappings(metadata, workspace, mappingConsumerId, runtime.coordinator, runtime.views) });
  const result = await executor.run(executable, metadata.loader.kind === 'forge' ? 17 : 21, plan, signal);
  const loader = metadata.loader;
  const profile = parseStoredInstallerProfile(loader.kind, loader.kind === 'forge' ? '1.20.1' : '1.21.1', loader.version,
    loader.profileBody, loader.profileSha256, loader.versionBody, loader.versionSha256);
  return result.map((step, index) => ({ role: step.role, tool: profile.processors[index]!.tool,
    mainClass: plan.commands[index]!.mainClass,
    outputs: step.outputs.map(output => ({ path: path.relative(path.join(workspace, 'libraries'), output.file).split(path.sep).join('/'),
      size: output.size, sha1: output.sha1, sha256: output.sha256, ...(output.upstreamSha1 ? { upstreamSha1: output.upstreamSha1 } : {}) })) }));
}
