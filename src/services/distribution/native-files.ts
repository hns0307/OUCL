import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { installRelativePath } from '../../core/install/assets.js';
import { guardDirectory, readRegular } from '../storage/files.js';
import { DistributionTransactionError } from './transaction-record.js';
import type { FileProof } from './transaction-record.js';
import { DistributionTransactionFiles } from './transaction-files.js';
import type { AtomicDistributionMutations, DistributionMutationContext } from './transaction-files.js';

const NATIVE_CODES = ['INVALID_REQUEST', 'UNSUPPORTED_VERSION', 'UNSAFE_PATH', 'ROOT_CHANGED', 'LEASE_MISMATCH', 'PROOF_MISMATCH', 'DESTINATION_EXISTS', 'FILE_BUSY', 'CROSS_VOLUME', 'IO_FAILED'] as const;
export interface DistributionNativeExecutable { executable: string; sha256: string }
function unsafe(): never { throw new DistributionTransactionError('FILES_CHANGED'); }
function unavailable(): never { throw new DistributionTransactionError('NEEDS_RECOVERY'); }
function isIdentity(value: unknown): value is { dev: string; ino: string } {
  return exactObject(value, ['dev', 'ino']) && typeof value.dev === 'string' && /^\d+$/.test(value.dev) && typeof value.ino === 'string' && /^[1-9]\d*$/.test(value.ino);
}
function validatePath(context: DistributionMutationContext, file: string, release: boolean): void {
  if (typeof file !== 'string' || !path.win32.isAbsolute(file)) unsafe();
  const relative = path.win32.relative(context.root, file);
  if (!relative || path.win32.isAbsolute(relative) || relative.startsWith('..')) unsafe();
  const parts = relative.split('\\');
  if (release) { if (parts.length !== 1 || parts[0] !== 'oucl.session.lock') unsafe(); return; }
  try { installRelativePath(parts.join('/')); } catch { unsafe(); }
  if (['mods', 'resourcepacks', 'config'].includes(parts[0]!) && parts.length > 1) return;
  if (parts.length === 3 && parts[0] === '.oucl-distribution-staging' && parts[1] === context.txId && /^(0|[1-9]\d{0,2})\.(new|old|rollback)$/.test(parts[2]!)) return;
  unsafe();
}

/** Fixed verified own helper, single request on stdin. It has no renderer bridge or arbitrary-command interface. */
export class WindowsDistributionMutations implements AtomicDistributionMutations {
  constructor(private readonly binary: DistributionNativeExecutable, private readonly timeoutMs = 30000) {
    if (!path.isAbsolute(binary.executable) || !/^[a-f0-9]{64}$/.test(binary.sha256) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) unavailable();
  }
  async mutate(operation: 'rename' | 'link' | 'delete' | 'release', context: DistributionMutationContext, source: string, expected: FileProof, destination?: string): Promise<void> {
    if (process.platform !== 'win32' || !['rename', 'link', 'delete', 'release'].includes(operation)) unavailable();
    if (!exactObject(context, ['root', 'txId', 'rootIdentity', 'leaseToken']) || typeof context.root !== 'string' || !/^[A-Za-z]:\\/.test(context.root)
      || typeof context.txId !== 'string' || !UUID_PATTERN.test(context.txId) || context.txId !== context.txId.toLowerCase() || !isIdentity(context.rootIdentity)
      || typeof context.leaseToken !== 'string' || !UUID_PATTERN.test(context.leaseToken) || context.leaseToken !== context.leaseToken.toLowerCase()
      || !exactObject(expected, ['dev', 'ino', 'sha256', 'size']) || !isIdentity({ dev: expected.dev, ino: expected.ino })
      || typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256) || typeof expected.size !== 'number' || !Number.isSafeInteger(expected.size) || expected.size < 0 || expected.size > 1024 ** 3) unsafe();
    validatePath(context, source, operation === 'release');
    if (operation === 'rename' || operation === 'link') { if (destination === undefined) unsafe(); validatePath(context, destination, false); }
    else if (destination !== undefined) unsafe();
    await guardDirectory(path.dirname(this.binary.executable));
    const bytes = await readRegular(this.binary.executable, 4 * 1024 ** 2);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== this.binary.sha256) unavailable();
    const request = JSON.stringify({ version: 1, operation, ...context, source, ...(destination !== undefined ? { destination } : {}), expected });
    if (Buffer.byteLength(request) > 16384) unsafe();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.binary.executable, [], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let outputBytes = 0; let errorBytes = 0; let uncertain = false;
      const stop = (): void => { uncertain = true; child.kill(); };
      const timer = setTimeout(stop, this.timeoutMs);
      child.stdin.on('error', () => { uncertain = true; });
      child.stdout.on('data', (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > 4096) stop(); else output += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 4096) stop(); });
      child.once('error', () => { clearTimeout(timer); reject(new DistributionTransactionError('NEEDS_RECOVERY')); });
      // Wait for the owned process to close even after timeout: rollback must not race a still-running mutation.
      child.once('close', code => {
        clearTimeout(timer);
        if (uncertain || outputBytes > 4096 || errorBytes > 0) { reject(new DistributionTransactionError('NEEDS_RECOVERY')); return; }
        try {
          const result: unknown = JSON.parse(output);
          if (code === 0 && exactObject(result, ['version', 'ok']) && result.version === 1 && result.ok === true) { resolve(); return; }
          if (!exactObject(result, ['version', 'ok', 'code']) || result.version !== 1 || result.ok !== false || typeof result.code !== 'string' || !NATIVE_CODES.includes(result.code as typeof NATIVE_CODES[number])) throw new Error();
          reject(new DistributionTransactionError(['PROOF_MISMATCH', 'ROOT_CHANGED', 'DESTINATION_EXISTS', 'UNSAFE_PATH', 'CROSS_VOLUME'].includes(result.code) ? 'FILES_CHANGED' : 'NEEDS_RECOVERY'));
        } catch { reject(new DistributionTransactionError('NEEDS_RECOVERY')); }
      });
      child.stdin.end(request);
    });
  }
}

/** Product callers must use this factory rather than the cooperative test adapter. */
export function createWindowsDistributionFiles(binary: DistributionNativeExecutable) {
  const mutations = new WindowsDistributionMutations(binary);
  return (gameDir: string, txId: string, expectedRoot?: DistributionMutationContext['rootIdentity']): DistributionTransactionFiles =>
    new DistributionTransactionFiles(gameDir, txId, { mutations, ...(expectedRoot ? { expectedRoot } : {}) });
}

/** Loads only the helper metadata shipped inside the verified application payload; never a user-selected executable. */
export async function loadWindowsDistributionFiles(nativeDirectory: string) {
  if (process.platform !== 'win32' || process.arch !== 'x64') unavailable();
  await guardDirectory(nativeDirectory);
  const metadataBytes = await readRegular(path.join(nativeDirectory, 'distribution-files.json'), 1024);
  if (!metadataBytes) unavailable();
  let metadata: unknown;
  try { metadata = JSON.parse(metadataBytes.toString('utf8')); } catch { unavailable(); }
  if (!exactObject(metadata, ['formatVersion', 'file', 'sha256', 'bytes']) || metadata.formatVersion !== 1 || metadata.file !== 'distribution-files.exe'
    || typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sha256) || typeof metadata.bytes !== 'number' || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 1 || metadata.bytes > 4 * 1024 ** 2) unavailable();
  const executable = path.join(nativeDirectory, 'distribution-files.exe'); const binary = await readRegular(executable, 4 * 1024 ** 2);
  if (!binary || binary.length !== metadata.bytes || createHash('sha256').update(binary).digest('hex') !== metadata.sha256) unavailable();
  return createWindowsDistributionFiles({ executable, sha256: metadata.sha256 });
}
