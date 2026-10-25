import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { guardDirectory } from '../storage/files.js';

export type JavaProbeCode = 'INVALID_JAVA' | 'UNSUPPORTED_JAVA' | 'PROBE_FAILED' | 'TIMEOUT' | 'OUTPUT_LIMIT' | 'CANCELLED';
/** Fixed probe failures never include executable paths, environment values or JVM output. */
export class JavaProbeError extends Error {
  readonly category: 'validation' | 'system' | 'cancelled';
  constructor(readonly code: JavaProbeCode) {
    super(code); this.name = 'JavaProbeError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'INVALID_JAVA' || code === 'UNSUPPORTED_JAVA' ? 'validation' : 'system';
  }
}
export interface JavaProperties { major: 8 | 17 | 21; version: string; vendor: string; architecture: 'x64'; os: 'windows' }
export interface JavaRuntime extends JavaProperties { executable: string }
export interface JavaProbeProcess {
  stdout: Readable; stderr: Readable;
  once(event: 'error', callback: (error: unknown) => void): unknown;
  once(event: 'close', callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}
export interface JavaStartOptions {
  shell: false; windowsHide: true; cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'];
}
export interface JavaProbeDependencies {
  inspect?: (file: string) => Promise<void>;
  start?: (file: string, args: readonly string[], options: JavaStartOptions) => JavaProbeProcess;
}
const MAX_OUTPUT = 64 * 1024;
const PROPERTIES = new Set(['java.version', 'java.specification.version', 'java.vendor', 'os.arch', 'os.name', 'sun.arch.data.model']);

/** Parses only explicit properties; banner words such as "64-Bit" cannot substitute for runtime architecture. */
export function parseJavaProperties(output: string): JavaProperties {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT) throw new JavaProbeError('OUTPUT_LIMIT');
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !PROPERTIES.has(match[1]!)) continue;
    if (values.has(match[1]!)) throw new JavaProbeError('INVALID_JAVA');
    values.set(match[1]!, match[2]!);
  }
  if ([...PROPERTIES].some(key => !values.has(key))) throw new JavaProbeError('INVALID_JAVA');
  const version = values.get('java.version')!; const specification = values.get('java.specification.version')!;
  const vendor = values.get('java.vendor')!; const os = values.get('os.name')!;
  if (!/^\d{1,3}(?:\.\d{1,6}){0,3}(?:_\d{1,6})?(?:[-+][A-Za-z0-9][A-Za-z0-9.+-]{0,63})?$/.test(version)
    || vendor.length < 1 || vendor.length > 160 || /[\p{C}]/u.test(vendor)) throw new JavaProbeError('INVALID_JAVA');
  const major = Number(/^(\d+)/.exec(version.startsWith('1.') ? version.slice(2) : version)?.[1]);
  if (![8, 17, 21].includes(major) || major === 8 && !/^1\.8\.0(?:_\d+)?(?:[-+].+)?$/.test(version)
    || major !== 8 && !new RegExp(`^${major}(?:[.\\-+]|$)`).test(version)
    || specification !== (major === 8 ? '1.8' : String(major))) throw new JavaProbeError('UNSUPPORTED_JAVA');
  if (!/^Windows(?: [A-Za-z0-9(). -]{1,80})?$/i.test(os) || !['amd64', 'x86_64'].includes(values.get('os.arch')!)
    || values.get('sun.arch.data.model') !== '64') throw new JavaProbeError('UNSUPPORTED_JAVA');
  return { major: major as 8 | 17 | 21, version, vendor, architecture: 'x64', os: 'windows' };
}
async function inspectJava(file: string): Promise<void> {
  await guardDirectory(path.dirname(file));
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0) throw new JavaProbeError('INVALID_JAVA');
}

/** Probes one explicitly selected/previously trusted executable; never scans disks or discovers arbitrary programs. */
export class JavaProbe {
  private readonly inspect: NonNullable<JavaProbeDependencies['inspect']>;
  private readonly start: NonNullable<JavaProbeDependencies['start']>;
  constructor(dependencies: JavaProbeDependencies = {}) {
    this.inspect = dependencies.inspect ?? inspectJava;
    this.start = dependencies.start ?? ((file, args, options) => spawn(file, [...args], options));
  }

  /** Cancellation, timeout and output overflow terminate the JVM and wait for close before rejecting. */
  async probe(executable: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<JavaRuntime> {
    const timeout = options.timeoutMs ?? 8000;
    if (typeof executable !== 'string' || executable.length > 32767 || executable.includes('\0') || !path.isAbsolute(executable)
      || path.basename(executable).toLowerCase() !== 'java.exe' || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw new JavaProbeError('INVALID_JAVA');
    if (options.signal?.aborted) throw new JavaProbeError('CANCELLED');
    try { await this.inspect(executable); } catch { throw new JavaProbeError('INVALID_JAVA'); }
    if (options.signal?.aborted) throw new JavaProbeError('CANCELLED');
    const env = { ...process.env };
    // Ambient agent/classpath injection must not turn a version probe into arbitrary Java execution.
    for (const key of Object.keys(env)) if (['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH'].includes(key.toUpperCase())) delete env[key];
    let child: JavaProbeProcess;
    try { child = this.start(executable, ['-XshowSettings:properties', '-version'], { shell: false, windowsHide: true, cwd: path.dirname(executable), env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { throw new JavaProbeError('PROBE_FAILED'); }
    return new Promise<JavaRuntime>((resolve, reject) => {
      const chunks: Buffer[] = []; let bytes = 0; let failure: JavaProbeError | undefined; let closed = false;
      const stop = (error: JavaProbeError): void => {
        if (closed || failure) return;
        failure = error; try { child.kill('SIGKILL'); } catch { /* Keep waiting for close; never claim a live child was stopped. */ }
      };
      const abort = (): void => stop(new JavaProbeError('CANCELLED'));
      const receive = (value: unknown): void => {
        if (failure) return;
        if (!Buffer.isBuffer(value) && typeof value !== 'string') { stop(new JavaProbeError('PROBE_FAILED')); return; }
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value); bytes += chunk.length;
        if (bytes > MAX_OUTPUT) { stop(new JavaProbeError('OUTPUT_LIMIT')); return; }
        chunks.push(chunk);
      };
      const timer = setTimeout(() => stop(new JavaProbeError('TIMEOUT')), timeout);
      child.stdout.on('data', receive); child.stderr.on('data', receive);
      child.stdout.once('error', () => stop(new JavaProbeError('PROBE_FAILED')));
      child.stderr.once('error', () => stop(new JavaProbeError('PROBE_FAILED')));
      child.once('error', () => stop(new JavaProbeError('PROBE_FAILED')));
      child.once('close', (code, signal) => {
        closed = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        if (failure) { reject(failure); return; }
        if (code !== 0 || signal !== null) { reject(new JavaProbeError('PROBE_FAILED')); return; }
        try {
          const output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          resolve({ ...parseJavaProperties(output), executable });
        } catch (error) { reject(error instanceof JavaProbeError ? error : new JavaProbeError('INVALID_JAVA')); }
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
}
