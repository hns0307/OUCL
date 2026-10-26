import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { JavaProbe } from '../java/probe.js';
import type { HashPool } from '../workers/hash-pool.js';
import type { HashResult } from '../workers/protocol.js';
import type { InstallerProcessorPlan, ProcessorCommandPlan } from './processor-plan.js';

export type ProcessorExecutionCode = 'INVALID_PROCESSOR_PLAN' | 'JAVA_INCOMPATIBLE' | 'PROCESSOR_FAILED'
  | 'PROCESSOR_TIMEOUT' | 'OUTPUT_LIMIT' | 'OUTPUT_INVALID' | 'CANCELLED';
export class ProcessorExecutionError extends Error {
  readonly category: 'validation' | 'system' | 'cancelled';
  constructor(readonly code: ProcessorExecutionCode) { super(code); this.name = 'ProcessorExecutionError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'INVALID_PROCESSOR_PLAN' || code === 'OUTPUT_INVALID' ? 'validation' : 'system'; }
}
export interface ProcessorOutputEvidence extends HashResult { file: string; upstreamSha1?: string }
export interface ProcessorStepEvidence { role: ProcessorCommandPlan['role']; tool: string; outputs: ProcessorOutputEvidence[] }
interface Dependencies {
  probe: Pick<JavaProbe, 'probe'>; hash: Pick<HashPool, 'hash'>;
  validateArchive: (file: string, sha256: string, size: number, signal?: AbortSignal) => Promise<void>;
  start?: (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; shell: false; windowsHide: true; stdio: 'pipe' }) => ChildProcessWithoutNullStreams;
  inspect?: (file: string) => Promise<'missing' | 'file' | 'other'>;
  prepareMojangMappings?: (command: ProcessorCommandPlan, signal?: AbortSignal) => Promise<void>;
}
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_ARTIFACT_BYTES = 1024 ** 3;

async function inspect(file: string): Promise<'missing' | 'file' | 'other'> {
  try { const info = await lstat(file); return info.isFile() && !info.isSymbolicLink() ? 'file' : 'other'; }
  catch (error) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' ? 'missing' : 'other'; }
}

/** Executes a closed processor plan serially. It never returns raw child output or accepts renderer commands. */
export class InstallerProcessorExecutor {
  private readonly start: NonNullable<Dependencies['start']>;
  private readonly inspect: NonNullable<Dependencies['inspect']>;
  constructor(private readonly dependencies: Dependencies, private readonly stepTimeoutMs = 10 * 60 * 1000,
    private readonly stopTimeoutMs = 5000) {
    if (!Number.isSafeInteger(stepTimeoutMs) || stepTimeoutMs < 1000 || stepTimeoutMs > 30 * 60 * 1000
      || !Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1 || stopTimeoutMs > 30000) throw new ProcessorExecutionError('INVALID_PROCESSOR_PLAN');
    this.start = dependencies.start ?? ((file, args, options) => spawn(file, args, options)); this.inspect = dependencies.inspect ?? inspect;
  }

  async run(executable: string, major: 17 | 21, plan: InstallerProcessorPlan, signal?: AbortSignal): Promise<ProcessorStepEvidence[]> {
    const cancel = (): void => { if (signal?.aborted) throw new ProcessorExecutionError('CANCELLED'); };
    cancel();
    try { const runtime = await this.dependencies.probe.probe(executable, { ...(signal === undefined ? {} : { signal }) }); if (runtime.major !== major || runtime.architecture !== 'x64') throw new Error(); }
    catch { cancel(); throw new ProcessorExecutionError('JAVA_INCOMPATIBLE'); }
    const evidence: ProcessorStepEvidence[] = [];
    for (const command of plan.commands) {
      cancel();
      for (const output of command.outputs) if (await this.inspect(output.file) !== 'missing') throw new ProcessorExecutionError('OUTPUT_INVALID');
      if (command.role === 'download-mojang-mappings') {
        if (!this.dependencies.prepareMojangMappings) throw new ProcessorExecutionError('INVALID_PROCESSOR_PLAN');
        await this.dependencies.prepareMojangMappings(command, signal);
      } else await this.execute(executable, plan.workspace, command, signal);
      cancel();
      const outputs: ProcessorOutputEvidence[] = [];
      for (const output of command.outputs) {
        let result: HashResult; try { result = await this.dependencies.hash.hash(output.file, { maximumBytes: MAX_ARTIFACT_BYTES,
          ...(signal === undefined ? {} : { signal }) }); }
        catch { cancel(); throw new ProcessorExecutionError('OUTPUT_INVALID'); }
        if (result.size < 1 || output.expectedSha1 !== undefined && result.sha1 !== output.expectedSha1) throw new ProcessorExecutionError('OUTPUT_INVALID');
        if (/\.(?:jar|zip)$/i.test(output.file)) {
          try { await this.dependencies.validateArchive(output.file, result.sha256, result.size, signal); }
          catch { cancel(); throw new ProcessorExecutionError('OUTPUT_INVALID'); }
        }
        outputs.push({ file: output.file, ...result, ...(output.expectedSha1 === undefined ? {} : { upstreamSha1: output.expectedSha1 }) });
      }
      evidence.push({ role: command.role, tool: command.tool, outputs });
    }
    return evidence;
  }

  private execute(executable: string, workspace: string, command: ProcessorCommandPlan, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new ProcessorExecutionError('CANCELLED'));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH'].includes(key.toUpperCase())) delete env[key];
    let child: ChildProcessWithoutNullStreams;
    try { child = this.start(executable, ['-cp', command.classpath.join(path.delimiter), command.mainClass, ...command.arguments],
      { cwd: workspace, env, shell: false, windowsHide: true, stdio: 'pipe' }); }
    catch { return Promise.reject(new ProcessorExecutionError('PROCESSOR_FAILED')); }
    child.stdin.end();
    return new Promise((resolve, reject) => {
      let bytes = 0; let failure: ProcessorExecutionError | undefined; let stopping = false; let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const terminate = (error: ProcessorExecutionError): void => {
        failure ??= error; if (stopping) return; stopping = true;
        try { child.kill('SIGTERM'); } catch { /* close/error still decides ownership */ }
        forceTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* wait for close */ } }, this.stopTimeoutMs);
      };
      const receive = (value: unknown): void => {
        if (failure) return; if (!Buffer.isBuffer(value) && typeof value !== 'string') { terminate(new ProcessorExecutionError('PROCESSOR_FAILED')); return; }
        bytes += Buffer.byteLength(value); if (bytes > MAX_OUTPUT_BYTES) terminate(new ProcessorExecutionError('OUTPUT_LIMIT'));
      };
      const abort = (): void => terminate(new ProcessorExecutionError('CANCELLED'));
      const timer = setTimeout(() => terminate(new ProcessorExecutionError('PROCESSOR_TIMEOUT')), this.stepTimeoutMs);
      child.stdout.on('data', receive); child.stderr.on('data', receive);
      child.stdout.once('error', () => terminate(new ProcessorExecutionError('PROCESSOR_FAILED')));
      child.stderr.once('error', () => terminate(new ProcessorExecutionError('PROCESSOR_FAILED')));
      child.once('error', () => terminate(new ProcessorExecutionError('PROCESSOR_FAILED')));
      child.once('close', (code, processSignal) => {
        clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
        if (failure) reject(failure); else if (code !== 0 || processSignal !== null) reject(new ProcessorExecutionError('PROCESSOR_FAILED')); else resolve();
      });
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }
}
