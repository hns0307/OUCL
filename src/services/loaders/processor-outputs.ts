import { chmod, copyFile, lstat, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { installRelativePath } from '../../core/install/assets.js';
import type { PersistedProcessorEvidence, PersistedProcessorOutput } from '../storage/instance-records.js';
import type { HashPool } from '../workers/hash-pool.js';
import { guardDirectory, hasCode } from '../storage/files.js';

export class ProcessorOutputError extends Error {
  readonly category: 'disk' | 'cancelled';
  constructor(readonly code: 'NEEDS_RECOVERY' | 'CANCELLED') { super(code); this.name = 'ProcessorOutputError'; this.category = code === 'CANCELLED' ? 'cancelled' : 'disk'; }
}
const cancelled = (signal: AbortSignal): void => { if (signal.aborted) throw new ProcessorOutputError('CANCELLED'); };

async function verify(file: string, output: PersistedProcessorOutput, hashes: Pick<HashPool, 'hash'>, signal: AbortSignal): Promise<void> {
  cancelled(signal); await guardDirectory(path.dirname(file)); const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== output.size) throw new ProcessorOutputError('NEEDS_RECOVERY');
  const result = await hashes.hash(file, { maximumBytes: output.size, signal });
  if (result.sha256 !== output.sha256 || result.sha1 !== output.sha1 || result.size !== output.size
    || output.upstreamSha1 !== undefined && result.sha1 !== output.upstreamSha1) throw new ProcessorOutputError('NEEDS_RECOVERY');
}

/** Publishes derived files without granting them upstream download provenance or replacing unknown content. */
export async function publishProcessorOutputs(workspace: string, libraries: string, evidence: readonly PersistedProcessorEvidence[],
  hashes: Pick<HashPool, 'hash'>, signal: AbortSignal): Promise<void> {
  await guardDirectory(workspace); await guardDirectory(libraries);
  for (const step of evidence) for (const output of step.outputs) {
    cancelled(signal); installRelativePath(output.path);
    const source = path.join(workspace, 'libraries', output.path); await verify(source, output, hashes, signal);
    const parts = output.path.split('/'); const name = parts.pop()!; let parent = libraries;
    for (const part of parts) {
      await guardDirectory(parent); parent = path.join(parent, part);
      try { await mkdir(parent); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
      await guardDirectory(parent);
    }
    const target = path.join(parent, name); cancelled(signal);
    try { await copyFile(source, target, constants.COPYFILE_EXCL); await chmod(target, 0o444); }
    catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
    await verify(target, output, hashes, signal);
  }
}

/** Revalidates every derived dependency before launching an installed Forge-family instance. */
export async function verifyProcessorOutputs(libraries: string, evidence: readonly PersistedProcessorEvidence[],
  hashes: Pick<HashPool, 'hash'>, signal: AbortSignal): Promise<void> {
  await guardDirectory(libraries);
  for (const step of evidence) for (const output of step.outputs) {
    installRelativePath(output.path); await verify(path.join(libraries, output.path), output, hashes, signal);
  }
}
