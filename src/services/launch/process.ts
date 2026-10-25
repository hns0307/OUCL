import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { LaunchPlan } from '../../core/launch/plan.js';
import { JavaProbe } from '../java/probe.js';
import type { JavaRuntime } from '../java/probe.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';

export type GameProcessCode = 'INSTANCE_BUSY' | 'JAVA_INCOMPATIBLE' | 'LAUNCH_FAILED' | 'CANCELLED' | 'SESSION_NOT_FOUND'
  | 'CONFIRMATION_REQUIRED' | 'STOP_UNSUPPORTED' | 'NEEDS_RECOVERY';
export class GameProcessError extends Error {
  readonly category: 'biz' | 'system' | 'cancelled' | 'disk';
  constructor(readonly code: GameProcessCode) {
    super(code); this.name = 'GameProcessError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'NEEDS_RECOVERY' ? 'disk' : code === 'LAUNCH_FAILED' ? 'system' : 'biz';
  }
}
export interface GameSession { sessionId: string; instanceId: string; state: 'running' | 'stopping' | 'exited' | 'unknown'; revision: number; startedAt: string; exitCode?: number }
interface LiveSession { snapshot: GameSession; child: ChildProcessWithoutNullStreams; ended: Promise<void>; lines: string[] }
interface Dependencies {
  probe?: Pick<JavaProbe, 'probe'>;
  start?: (executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; shell: false; windowsHide: true; stdio: 'pipe' }) => ChildProcessWithoutNullStreams;
}

/** Owns child processes and gameDir leases. A crashed/foreign lease is never stolen by PID or age. */
export class GameProcessService {
  private readonly live = new Map<string, LiveSession>();
  private readonly probe: Pick<JavaProbe, 'probe'>;
  private readonly start: NonNullable<Dependencies['start']>;
  constructor(dependencies: Dependencies = {}) {
    this.probe = dependencies.probe ?? new JavaProbe();
    this.start = dependencies.start ?? ((executable, args, options) => spawn(executable, args, options));
  }

  /** Caller resolves executableRef from its trusted Java registry and verifies every installed dependency first. */
  async launch(instanceId: string, executable: string, major: 8 | 17 | 21, plan: LaunchPlan, options: { signal?: AbortSignal; sessionId?: string; initialRevision?: number } = {}): Promise<GameSession> {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(instanceId)) throw new GameProcessError('LAUNCH_FAILED');
    if (options.sessionId !== undefined && (!UUID_PATTERN.test(options.sessionId) || this.live.has(options.sessionId))
      || options.initialRevision !== undefined && (!Number.isSafeInteger(options.initialRevision) || options.initialRevision < 1 || options.initialRevision >= Number.MAX_SAFE_INTEGER)) throw new GameProcessError('LAUNCH_FAILED');
    const cancelled = (): void => { if (options.signal?.aborted) throw new GameProcessError('CANCELLED'); };
    cancelled();
    let runtime: JavaRuntime;
    try { runtime = await this.probe.probe(executable, options); }
    catch { cancelled(); throw new GameProcessError('JAVA_INCOMPATIBLE'); }
    if (runtime.major !== major || runtime.architecture !== 'x64') throw new GameProcessError('JAVA_INCOMPATIBLE');
    const directory = await guardDirectory(plan.cwd); cancelled();
    const sessionId = options.sessionId ?? randomUUID(); const token = randomUUID(); const file = path.join(directory, 'oucl.session.lock');
    let handle;
    try { handle = await open(file, 'wx'); }
    catch (error) { throw new GameProcessError(hasCode(error, 'EEXIST') ? 'INSTANCE_BUSY' : 'LAUNCH_FAILED'); }
    const release = async (): Promise<void> => {
      if (await guardDirectory(directory) !== directory || (await readRegular(file, 100))?.toString('utf8') !== token) throw new GameProcessError('NEEDS_RECOVERY');
      await unlink(file);
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      await handle.writeFile(token); await handle.sync(); await handle.close(); cancelled();
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH'].includes(key.toUpperCase())) delete env[key];
      child = this.start(runtime.executable, [...plan.args], { cwd: directory, env, shell: false, windowsHide: true, stdio: 'pipe' });
    } catch (error) {
      await handle.close().catch(() => {});
      try { await release(); } catch { throw new GameProcessError('NEEDS_RECOVERY'); }
      if (error instanceof GameProcessError) throw error;
      throw new GameProcessError('LAUNCH_FAILED');
    }
    const snapshot: GameSession = { sessionId, instanceId, state: 'running', revision: options.initialRevision ?? 1, startedAt: new Date().toISOString() };
    let resolveExit!: () => void; const ended = new Promise<void>(resolve => { resolveExit = resolve; });
    const live: LiveSession = { snapshot, child, ended, lines: [] }; this.live.set(sessionId, live);
    // Consume both pipes with bounded line buffers. Raw output is never persisted or returned.
    const capture = (stream: NodeJS.ReadableStream): void => {
      let pending = ''; let dropping = false; const decoder = new TextDecoder();
      const append = (line: string): void => {
        // Keep only fixed milestones, never user names, tokens, device names, paths or arbitrary game text.
        const marker = /Setting user:/.test(line) ? 'game:identity-bound' : /Backend library:|LWJGL Version:/.test(line) ? 'game:renderer-initializing'
          : /Sound engine started/.test(line) ? 'game:sound-ready' : /Created:.*textures\/atlas\/blocks/.test(line) ? 'game:blocks-atlas-ready'
          : /Stopping!/.test(line) ? 'game:stopping' : /Exception in thread|Crash report saved/.test(line) ? 'game:failure-output' : undefined;
        if (marker) { live.lines.push(marker); if (live.lines.length > 100) live.lines.shift(); }
      };
      stream.on('data', (chunk: Buffer) => {
        // Never emit a partial overlong line: a secret may cross chunk/line-limit boundaries.
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split(/\r?\n/); pending = lines.pop() ?? '';
        for (const line of lines) { if (!dropping && line.length <= 8192) append(line); dropping = false; }
        if (pending.length > 8192) { pending = ''; dropping = true; }
      });
      stream.on('error', () => { pending = ''; });
    };
    capture(child.stdout); capture(child.stderr); child.stdin.end();
    child.once('close', (code: number | null) => {
      void release().then(() => {
        live.snapshot = { ...live.snapshot, state: 'exited', revision: live.snapshot.revision + 1, ...(code === null ? {} : { exitCode: code }) };
      }, () => { live.snapshot = { ...live.snapshot, state: 'unknown', revision: live.snapshot.revision + 1 }; }).finally(resolveExit);
    });
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => { reject(new GameProcessError('LAUNCH_FAILED')); }); });
    } catch { await ended; throw new GameProcessError(live.snapshot.state === 'unknown' ? 'NEEDS_RECOVERY' : 'LAUNCH_FAILED'); }
    // Spawn is the commit boundary. Subsequent cancellation must use an explicit session stop.
    return { ...live.snapshot };
  }

  /** Returns only the service-owned session; no OS PID/path is exposed. */
  get(sessionId: string): GameSession { return { ...this.session(sessionId).snapshot }; }
  /** Bounded diagnostics are for the trusted launch adapter, never arbitrary filesystem logs. */
  diagnostics(sessionId: string): readonly string[] { return [...this.session(sessionId).lines]; }
  private session(sessionId: string): LiveSession {
    const live = this.live.get(sessionId); if (!live) throw new GameProcessError('SESSION_NOT_FOUND'); return live;
  }
  /** Waits for actual close and owned lease release; no timeout implies success. */
  async wait(sessionId: string): Promise<GameSession> { await this.session(sessionId).ended; return this.get(sessionId); }
  /** Windows has no supported graceful JVM shutdown here. Never silently turn it into a force kill. */
  async stop(sessionId: string, mode: 'graceful' | 'force', confirmed: boolean): Promise<GameSession> {
    const live = this.session(sessionId);
    if (live.snapshot.state === 'exited') return this.get(sessionId);
    if (mode !== 'force') throw new GameProcessError('STOP_UNSUPPORTED');
    if (!confirmed) throw new GameProcessError('CONFIRMATION_REQUIRED');
    if (live.snapshot.state === 'unknown') throw new GameProcessError('NEEDS_RECOVERY');
    live.snapshot = { ...live.snapshot, state: 'stopping', revision: live.snapshot.revision + 1 };
    if (!live.child.kill('SIGKILL')) throw new GameProcessError('STOP_UNSUPPORTED');
    return this.wait(sessionId);
  }
}
