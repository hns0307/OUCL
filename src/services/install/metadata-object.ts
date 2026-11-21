import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import type { PlannedArtifact } from '../../core/install/plan.js';
import type { ObjectStore, ObjectRef } from '../objects/store.js';
import type { DownloadSpec } from '../download/types.js';
import { DownloadError } from '../download/types.js';
import { ObjectError } from '../objects/provenance.js';
import { hasCode } from '../storage/files.js';

/** Converts each independently trusted planning proof to the existing object-store definition. */
export function artifactSpec(artifact: PlannedArtifact, proof = artifact.proofs[0]): DownloadSpec {
  if (!proof) throw new DownloadError('INVALID_TRANSFER');
  return { url: artifact.url, expected: { algorithm: 'sha1', digest: artifact.sha1, size: artifact.size, provenanceId: proof.provenanceId },
    anchor: { kind: proof.source.kind, algorithm: proof.source.algorithm, digest: proof.source.digest } };
}

/** Imports exact verified metadata bytes without broadening the artifact-network host whitelist. */
export async function importAssetIndex(objects: Pick<ObjectStore, 'lookup' | 'createStaging' | 'commit' | 'discardStaging'>,
  artifact: PlannedArtifact, body: string, signal?: AbortSignal): Promise<ObjectRef> {
  try { return await importIndex(objects, artifact, body, signal); }
  catch (error) {
    if (error instanceof DownloadError || error instanceof ObjectError) throw error;
    throw new DownloadError(hasCode(error, 'ENOSPC') ? 'DISK_FULL'
      : hasCode(error, 'EACCES') || hasCode(error, 'EPERM') ? 'DISK_PERMISSION' : 'TRANSFER_IO');
  }
}

async function importIndex(objects: Pick<ObjectStore, 'lookup' | 'createStaging' | 'commit' | 'discardStaging'>,
  artifact: PlannedArtifact, body: string, signal?: AbortSignal): Promise<ObjectRef> {
  const spec = artifactSpec(artifact); const bytes = Buffer.from(body, 'utf8');
  if (bytes.length !== artifact.size || createHash('sha1').update(bytes).digest('hex') !== artifact.sha1) throw new DownloadError('HASH_MISMATCH');
  if (signal?.aborted) throw new DownloadError('CANCELLED');
  const cached = await objects.lookup(spec.expected, spec.anchor);
  if (signal?.aborted) throw new DownloadError('CANCELLED');
  if (cached) return cached;
  const staging = await objects.createStaging();
  try {
    if (signal?.aborted) throw new DownloadError('CANCELLED');
    const before = await lstat(staging.file);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== 0) throw new DownloadError('NEEDS_RECOVERY');
    const handle = await open(staging.file, 'r+');
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== 0) throw new DownloadError('NEEDS_RECOVERY');
      await handle.writeFile(bytes); await handle.sync();
    } finally { await handle.close(); }
    if (signal?.aborted) throw new DownloadError('CANCELLED');
    // Once admitted, commit is joined even on cancellation; trusted shared content may safely remain cached.
    return await objects.commit(staging.id, spec.expected, spec.anchor);
  } finally { await objects.discardStaging(staging.id); }
}
