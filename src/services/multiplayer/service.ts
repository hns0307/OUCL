import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { lstat, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { exactObject } from '../../shared/contracts/handshake.js';
import type { LanGame, MultiplayerRelay, MultiplayerSnapshot, RoomCode, RoomSnapshot } from '../../shared/contracts/multiplayer.js';
import { isPort, isRelay } from '../../shared/contracts/multiplayer.js';
import { readRegular } from '../storage/files.js';
import { createRuntimeDirectory, makeEngineDirectory, MAX_ENGINE_ZIP, removeRuntimeDirectory } from './archive.js';
import { decodeInvite, encodeInvite, engineConfig, isSameLan, localLanAddress, newInvitation, normalizeRelay, relayIdentity, roomKeys, RoomError } from './config.js';
import type { Invitation } from './config.js';
import { acceptGuestProof, freePort, openGateway, ownsWindowsSocket, probeMinecraft, startEngine, verifyRoomHost } from './transport.js';
import type { EngineProcess } from './transport.js';

export interface OwnedLanSession extends LanGame { pid: number }
export interface MultiplayerGameSessions {
  getOwnedLanSession(sessionId: string): OwnedLanSession | undefined;
  listOwnedLanSessions(): readonly OwnedLanSession[];
  wait(sessionId: string): Promise<unknown>;
}
export interface MultiplayerDependencies {
  dataDirectory: string;
  games: MultiplayerGameSessions;
  roomProcessPath: string;
  archiveWorkerPath: string;
}
interface ActiveRoom {
  controller: AbortController;
  snapshot: RoomSnapshot;
  task?: Promise<void>;
  release?: Promise<void>;
  engine?: EngineProcess;
  workspace?: string;
  workspaceRoot?: string;
  gate?: Awaited<ReturnType<typeof openGateway>>;
  invite?: Invitation;
  watch?: ReturnType<typeof setTimeout>;
}
const STARTUP_MS = 18_000;
const JOIN_MS = 35_000;
const RECOVERY_MS = 35_000;
const POLL_MS = 3_000;

async function fileSize(file: string): Promise<number | undefined> {
  const info = await lstat(file).catch(() => undefined);
  return info?.isFile() && !info.isSymbolicLink() ? info.size : undefined;
}
async function workerJob(file: string, workerData: object, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new RoomError('CANCELLED');
  const worker = new Worker(file, { workerData });
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: RoomCode): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      void worker.terminate().then(() => error ? reject(new RoomError(error)) : resolve(),
        () => reject(new RoomError(error ?? 'ENGINE_INVALID')));
    };
    const cancel = (): void => finish('CANCELLED');
    const timer = setTimeout(() => finish('TIMEOUT'), STARTUP_MS);
    worker.once('message', (success: unknown) => finish(success === true ? undefined : 'ENGINE_INVALID'));
    worker.once('error', () => finish('ENGINE_INVALID'));
    worker.once('exit', () => finish('ENGINE_INVALID'));
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function redactGame({ sessionId, instanceId, detectedPort }: OwnedLanSession): LanGame {
  return { sessionId, instanceId, ...(isPort(detectedPort) ? { detectedPort } : {}) };
}

/** Owns one explicit Minecraft room, its guarded sockets, and the private EasyTier process. */
export class MultiplayerService {
  private readonly directory: string;
  private readonly shutdown = new AbortController();
  private active: ActiveRoom | undefined;
  private io: Promise<void> | undefined;
  private closeTask: Promise<void> | undefined;

  constructor(private readonly dependencies: MultiplayerDependencies) {
    this.directory = path.join(dependencies.dataDirectory, 'multiplayer');
  }

  private get zip(): string {
    return path.join(this.directory, 'easytier-v2.6.4.zip');
  }
  private async supported(): Promise<boolean> {
    return process.platform === 'win32' && process.arch === 'x64'
      && !!await fileSize(this.dependencies.roomProcessPath) && !!await fileSize(this.dependencies.archiveWorkerPath);
  }
  private async readRelay(): Promise<MultiplayerRelay | null> {
    const bytes = await readRegular(path.join(this.directory, 'relay.json'), 2048);
    if (!bytes) return null;
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!exactObject(value, ['schemaVersion', 'relay']) || value.schemaVersion !== 1 || value.relay !== null && !isRelay(value.relay))
      throw new RoomError('UNAVAILABLE');
    return value.relay === null ? null : normalizeRelay(value.relay);
  }

  /** Gets only sanitized state, with room codes available through a separate explicit action. */
  async snapshot(): Promise<MultiplayerSnapshot> {
    const [supported, size, relay] = await Promise.all([this.supported(), fileSize(this.zip), this.readRelay()]);
    return {
      supported,
      engineInstalled: !!size && size <= MAX_ENGINE_ZIP,
      relay,
      games: this.dependencies.games.listOwnedLanSessions().slice(0, 32).map(redactGame),
      room: this.active ? { ...this.active.snapshot, members: this.active.snapshot.members.map(member => ({ ...member })) } : null,
    };
  }

  private ensureIdle(): void {
    if (this.shutdown.signal.aborted) throw new RoomError('UNAVAILABLE');
    if (this.active && this.active.snapshot.phase !== 'failed' || this.io) throw new RoomError('ROOM_BUSY');
  }
  private async mutate(operation: () => Promise<void>): Promise<void> {
    this.ensureIdle();
    this.io = operation();
    try { await this.io; } finally { this.io = undefined; }
  }

  /** Stores optional, user-authorized private relay configuration without room secrets. */
  async configure(relay: MultiplayerRelay | null): Promise<void> {
    const value = relay ? normalizeRelay(relay) : null;
    return this.mutate(async () => {
      const directory = await makeEngineDirectory(this.directory);
      const temp = path.join(directory, '.relay-' + randomUUID());
      try {
        await writeFile(temp, JSON.stringify({ schemaVersion: 1, relay: value }), { mode: 0o600, flag: 'wx', flush: true });
        if (this.shutdown.signal.aborted) throw new RoomError('CANCELLED');
        await rename(temp, path.join(directory, 'relay.json'));
      } finally {
        await rm(temp, { force: true }).catch(() => undefined);
      }
    });
  }

  /** Admits the fixed upstream checksum from a user-selected ZIP. */
  async importEngine(file: string): Promise<void> {
    return this.mutate(async () => {
      if (!await this.supported()) throw new RoomError('UNSUPPORTED_PLATFORM');
      await makeEngineDirectory(this.directory);
      await workerJob(this.dependencies.archiveWorkerPath, { action: 'import', source: file, destination: this.zip }, this.shutdown.signal);
    });
  }

  private begin(task: (room: ActiveRoom) => Promise<void>, id: string, role: 'host' | 'guest'): void {
    this.ensureIdle();
    const previous = this.active;
    const room: ActiveRoom = {
      controller: new AbortController(),
      snapshot: { id, role, phase: 'starting', transport: 'unknown', members: [] },
    };
    this.active = room;
    room.task = (async () => {
      if (previous) {
        await previous.task;
        await this.release(previous);
      }
      if (room.controller.signal.aborted) return;
      try { await task(room); }
      catch (error) {
        if (!room.controller.signal.aborted) {
          this.fail(room, error instanceof RoomError ? error.code : 'ENGINE_START_FAILED');
        }
      }
    })();
  }

  /** Starts a host room only for a current owned Java session and its Minecraft status port. */
  host(sessionId: string, manual?: number): void {
    this.begin(async room => {
      const game = this.dependencies.games.getOwnedLanSession(sessionId);
      if (!game) throw new RoomError('SESSION_UNAVAILABLE');
      const port = manual ?? game.detectedPort;
      if (!isPort(port)) throw new RoomError('GAME_PORT_UNVERIFIED');
      const signal = room.controller.signal;
      const stillOwned = (): boolean => this.dependencies.games.getOwnedLanSession(sessionId)?.pid === game.pid;
      const allow = async (clientPort?: number): Promise<boolean> => !signal.aborted && stillOwned()
        && await ownsWindowsSocket(this.dependencies.roomProcessPath, game.pid, port, signal, clientPort) && stillOwned() && !signal.aborted;
      if (!await this.supported()) throw new RoomError('UNSUPPORTED_PLATFORM');
      if (!await allow() || !await probeMinecraft(port, signal, allow)) throw new RoomError('GAME_PORT_UNVERIFIED');
      const relay = await this.readRelay();
      const address = localLanAddress();
      if (!address && !relay) throw new RoomError('RELAY_REQUIRED');
      const lan = address ? { address, port: await freePort(address) } : null;
      const engineKey = roomKeys();
      const proof = generateKeyPairSync('ed25519');
      const hostProof = proof.publicKey.export({ format: 'jwk' }).x;
      if (!hostProof) throw new RoomError('ENGINE_START_FAILED');
      room.gate = await openGateway((incoming, outgoing) => acceptGuestProof(incoming, proof.privateKey, () =>
        outgoing.localPort ? allow(outgoing.localPort) : Promise.resolve(false)), port);
      const invitation = newInvitation(room.snapshot.id, room.gate.port, engineKey.publicKey, hostProof, lan, relay);
      room.invite = invitation;
      room.snapshot.gamePort = port;
      const config = engineConfig({ invitation, role: 'host', relay, lan });
      const engine = await this.launch(room, invitation, config, engineKey.privateKey);
      if (!await allow()) throw new RoomError('GAME_PORT_UNVERIFIED');
      room.snapshot.phase = 'waiting';
      void this.dependencies.games.wait(sessionId).then(() => {
        if (!signal.aborted) this.fail(room, 'SESSION_UNAVAILABLE');
      }, () => {
        if (!signal.aborted) this.fail(room, 'SESSION_UNAVAILABLE');
      });
      this.watch(room, engine, async () => {
        if (!await allow()) throw new RoomError('GAME_PORT_UNVERIFIED');
      });
    }, randomUUID(), 'host');
  }

  /** Joins only validated local subnet endpoints or a separately configured, matching private relay. */
  join(code: string): void {
    const invitation = decodeInvite(code);
    this.begin(async room => {
      const localRelay = await this.readRelay();
      const relay = localRelay && invitation.relayId === relayIdentity(localRelay) ? localRelay : null;
      const lan = invitation.lan && isSameLan(invitation.lan.address) ? invitation.lan : null;
      if (!lan && !relay) throw new RoomError(invitation.relayId ? 'RELAY_REQUIRED' : 'NO_AUTHORIZED_ROUTE');
      const engineKey = roomKeys();
      const innerPort = await freePort('127.0.0.1');
      const config = engineConfig({ invitation, role: 'guest', relay, lan, localPort: innerPort });
      const engine = await this.launch(room, invitation, config, engineKey.privateKey);
      const signal = room.controller.signal;
      let lastConnected = Date.now();
      let wasConnected = false;
      let canConnect = false;
      room.gate = await openGateway((_incoming, outgoing) => canConnect && !signal.aborted
        ? verifyRoomHost(outgoing, invitation.hostProof) : Promise.resolve(false), innerPort);
      room.snapshot.phase = 'waiting';
      this.watch(room, engine, async observation => {
        canConnect = observation.hasHost;
        const port = room.gate?.port;
        if (canConnect && port && await probeMinecraft(port, signal)) {
          lastConnected = Date.now();
          wasConnected = true;
          room.snapshot.phase = 'connected';
          room.snapshot.localPort = port;
        } else {
          canConnect = false;
          room.snapshot.phase = wasConnected ? 'reconnecting' : 'waiting';
          delete room.snapshot.localPort;
          if (Date.now() - lastConnected >= (wasConnected ? RECOVERY_MS : JOIN_MS)) throw new RoomError('HOST_DISCONNECTED');
        }
      });
    }, invitation.id, 'guest');
  }

  private async launch(room: ActiveRoom, invitation: Invitation, config: ReturnType<typeof engineConfig>, key: string): Promise<EngineProcess> {
    if (!await this.supported()) throw new RoomError('UNSUPPORTED_PLATFORM');
    const size = await fileSize(this.zip);
    if (!size || size > MAX_ENGINE_ZIP) throw new RoomError('ENGINE_REQUIRED');
    const signal = room.controller.signal;
    room.workspaceRoot = await makeEngineDirectory(this.directory);
    room.workspace = await createRuntimeDirectory(room.workspaceRoot);
    await workerJob(this.dependencies.archiveWorkerPath, { action: 'prepare', zip: this.zip, workspace: room.workspace, size }, signal);
    const engine = await startEngine(this.dependencies.roomProcessPath, room.workspace, config.name, config.toml, key, invitation, room.snapshot.role, signal);
    room.engine = engine;
    void engine.ended.then(() => { if (!signal.aborted) this.fail(room, 'ENGINE_START_FAILED'); });
    const deadline = Date.now() + STARTUP_MS;
    while (!signal.aborted && Date.now() < deadline) {
      const ready = await engine.observe().then(value => value.ready, () => false);
      if (ready && await engine.policy().catch(() => false)) return engine;
      await delay(350, undefined, { signal });
    }
    throw new RoomError(signal.aborted ? 'CANCELLED' : 'ENGINE_START_FAILED');
  }

  private watch(room: ActiveRoom, engine: EngineProcess, update: (value: Awaited<ReturnType<EngineProcess['observe']>>) => Promise<void>): void {
    const signal = room.controller.signal;
    const poll = async (): Promise<void> => {
      try {
        const value = await engine.observe();
        if (signal.aborted) return;
        room.snapshot.members = value.members;
        room.snapshot.transport = value.transport;
        await update(value);
        if (room.snapshot.role === 'host') room.snapshot.phase = value.members.length > 1 ? 'connected' : 'waiting';
        if (!signal.aborted) room.watch = setTimeout(() => { void poll(); }, POLL_MS);
      } catch (error) {
        if (!signal.aborted) this.fail(room, error instanceof RoomError ? error.code : 'ROOM_UNAVAILABLE');
      }
    };
    void poll();
  }

  /** A bearer invitation is available only for an active host and is never recorded on disk. */
  invite(): string {
    const room = this.active;
    if (!room?.invite || room.controller.signal.aborted || room.snapshot.phase !== 'waiting' && room.snapshot.phase !== 'connected')
      throw new RoomError('ROOM_UNAVAILABLE');
    return encodeInvite(room.invite);
  }

  private fail(room: ActiveRoom, problem: RoomCode): void {
    if (room.controller.signal.aborted) return;
    room.snapshot.phase = 'failed';
    room.snapshot.problem = problem;
    room.snapshot.members = [];
    room.snapshot.transport = 'unknown';
    delete room.snapshot.localPort;
    room.controller.abort();
    // If the engine exits during startup, wait until startup stops creating resources.
    void room.task?.then(() => this.release(room));
  }

  private release(room: ActiveRoom): Promise<void> {
    if (room.release) return room.release;
    room.controller.abort();
    clearTimeout(room.watch);
    delete room.invite;
    room.release = (async () => {
      await Promise.allSettled([room.gate?.close(), room.engine?.close()]);
      if (room.workspaceRoot && room.workspace) await removeRuntimeDirectory(room.workspaceRoot, room.workspace).catch(() => undefined);
    })();
    return room.release;
  }

  /** Cancels pending work and waits until the owning room's sockets and child process close. */
  async leave(): Promise<void> {
    const room = this.active;
    if (!room) return;
    room.controller.abort();
    await room.task;
    await this.release(room);
    if (this.active === room) this.active = undefined;
  }

  /** Shuts down at the application's actual quit boundary. */
  close(): Promise<void> {
    if (!this.closeTask) {
      this.shutdown.abort();
      this.closeTask = Promise.allSettled([this.leave(), this.io]).then(() => undefined);
    }
    return this.closeTask;
  }
}
