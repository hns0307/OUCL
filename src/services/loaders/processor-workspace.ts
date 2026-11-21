import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArtifact, record } from '../../core/version/validation.js';
import { installRelativePath } from '../../core/install/assets.js';
import { parseStoredInstallerProfile } from './installer-compose.js';
import { rebuildPreparedInstallerPlan } from './installer-install-metadata.js';
import type { PreparedInstallerMetadata } from './installer-install-metadata.js';
import { planInstallerProcessors } from './processor-plan.js';
import type { ProcessorCommandPlan } from './processor-plan.js';
import { artifactSpec } from '../install/metadata-object.js';
import type { FileViewService } from '../install/file-views.js';
import type { DownloadedInstall } from '../install/downloads.js';
import type { ProcessorManifestReader } from '../workers/processor-manifest-reader.js';
import type { DownloadCoordinator } from '../download/coordinator.js';
import type { DownloadSpec } from '../download/types.js';
import { guardDirectory, hasCode } from '../storage/files.js';
import { createHash } from 'node:crypto';

export class ProcessorWorkspaceError extends Error {
  readonly category: 'validation' | 'cancelled';
  constructor(readonly code: 'INVALID_PROCESSOR_INPUT' | 'CANCELLED') { super(code); this.name = 'ProcessorWorkspaceError';
    this.category = code === 'CANCELLED' ? 'cancelled' : 'validation'; }
}
const invalid = (): never => { throw new ProcessorWorkspaceError('INVALID_PROCESSOR_INPUT'); };
const check = (signal: AbortSignal): void => { if (signal.aborted) throw new ProcessorWorkspaceError('CANCELLED'); };

/** Uses the original Mojang descriptor as the trust source; tools never download mappings themselves. */
export function clientMappingsSpec(metadata: PreparedInstallerMetadata): DownloadSpec {
  const minecraft = metadata.loader.kind === 'forge' ? '1.20.1' : '1.21.1';
  const body = metadata.versionDocuments[minecraft]; const digest = metadata.metadataSha1ByVersion[minecraft];
  if (!body || !digest || createHash('sha1').update(body).digest('hex') !== digest) return invalid();
  let value: unknown; try { value = JSON.parse(body) as unknown; } catch { return invalid(); }
  if (!record(value) || value.id !== minecraft || !record(value.downloads)) return invalid();
  let artifact; try { artifact = parseArtifact(value.downloads.client_mappings); } catch { return invalid(); }
  if (!/^https:\/\/piston-data\.mojang\.com\/v1\/objects\/[a-f0-9]{40}\/client\.txt$/.test(artifact.url)
    || !artifact.url.includes(`/${artifact.sha1}/`) || artifact.size < 1 || artifact.size > 64 * 1024 ** 2) return invalid();
  return { url: artifact.url, expected: { algorithm: 'sha1', digest: artifact.sha1, size: artifact.size,
    provenanceId: `version:${digest}:${artifact.sha1}` }, anchor: { kind: 'mojang-version', algorithm: 'sha1', digest } };
}

async function outputDirectories(workspace: string, relative: string): Promise<void> {
  installRelativePath(relative); let directory = await guardDirectory(workspace);
  for (const part of relative.split('/').slice(0, -1)) {
    directory = path.join(directory, part);
    try { await mkdir(directory); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
    await guardDirectory(directory);
  }
}

/** Copies verified tool inputs, checks actual tool manifests and prepares all output parents in a private tree. */
export async function prepareProcessorWorkspace(metadata: PreparedInstallerMetadata, downloaded: DownloadedInstall, workspace: string,
  views: Pick<FileViewService, 'materialize'>, manifests: Pick<ProcessorManifestReader, 'read'>, signal: AbortSignal) {
  check(signal); await guardDirectory(workspace);
  const loader = metadata.loader; const profile = parseStoredInstallerProfile(loader.kind, profileMinecraft(metadata), loader.version,
    loader.profileBody, loader.profileSha256, loader.versionBody, loader.versionSha256);
  const pinned = rebuildPreparedInstallerPlan(metadata);
  const client = pinned.views.find(view => view.area === 'version' && view.path === 'client.jar'); if (!client) return invalid();
  const copy = async (artifactId: string, relative: string) => {
    check(signal); const artifact = pinned.artifacts.find(item => item.artifactId === artifactId); const object = downloaded.objects.get(artifactId);
    if (!artifact || !object || object.size !== artifact.size) return invalid();
    await views.materialize(workspace, relative, artifactSpec(artifact), object, { mode: 'copy', signal }); check(signal); return object;
  };
  await copy(client.artifactId, 'minecraft/client.jar');
  const mainClasses: Record<string, string> = {};
  const tools = new Set(profile.processors.map(processor => processor.tool));
  for (const library of profile.libraries) {
    const object = await copy(`sha1-${library.sha1}`, `libraries/${library.path}`);
    if (tools.has(library.coordinate)) mainClasses[library.coordinate] = await manifests.read({
      file: path.join(workspace, 'libraries', library.path), sha256: object.digest, size: object.size }, signal);
  }
  const plan = planInstallerProcessors(profile, { workspace, installerFile: path.join(workspace, 'installer.jar'),
    minecraftJar: path.join(workspace, 'minecraft/client.jar'), mainClasses });
  for (const command of plan.commands) for (const output of command.outputs) {
    check(signal); await outputDirectories(workspace, path.relative(workspace, output.file).split(path.sep).join('/'));
  }
  return plan;
}

function profileMinecraft(metadata: PreparedInstallerMetadata): string {
  return metadata.loader.kind === 'forge' ? '1.20.1' : '1.21.1';
}

/** Supplies the executor's fixed mapping step through the shared trusted downloader. */
export function prepareMojangMappings(metadata: PreparedInstallerMetadata, workspace: string, consumerId: string,
  downloads: Pick<DownloadCoordinator, 'request'>, views: Pick<FileViewService, 'materialize'>) {
  const spec = clientMappingsSpec(metadata);
  const profile = parseStoredInstallerProfile(metadata.loader.kind, profileMinecraft(metadata), metadata.loader.version,
    metadata.loader.profileBody, metadata.loader.profileSha256, metadata.loader.versionBody, metadata.loader.versionSha256);
  const target = profile.data.MOJMAPS; if (target?.kind !== 'artifact') return invalid();
  return async (command: ProcessorCommandPlan, signal?: AbortSignal): Promise<void> => {
    if (command.role !== 'download-mojang-mappings' || command.outputs.length !== 1
      || path.resolve(command.outputs[0]!.file) !== path.resolve(workspace, 'libraries', target.path)) return invalid();
    const object = await downloads.request(spec, { consumerId, ...(signal ? { signal } : {}) }).result;
    await views.materialize(workspace, `libraries/${target.path}`, spec, object, { mode: 'copy', ...(signal ? { signal } : {}) });
  };
}
