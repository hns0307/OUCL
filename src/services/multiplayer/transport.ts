import { createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import type { Socket } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RoomMember, Transport } from '../../shared/contracts/multiplayer.js';
import { engineExecutable } from './archive.js';
import { RoomError } from './config.js';
import type { Invitation } from './config.js';

const exec = promisify(execFile);
const encoding = 'utf8' as const;
const LOOPBACK = '127.0.0.1';
const MAX_CONNECTIONS = 32;
const CLI_TIMEOUT = 1500;

function limitedEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
export async function ownsWindowsSocket(helper: string, pid: number, port: number, signal: AbortSignal, clientPort?: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) return false;
  const arguments_ = ['verify', pid.toString(), port.toString(), ...(clientPort ? [clientPort.toString()] : [])];
  try {
    await exec(helper, arguments_, { env: limitedEnvironment(), windowsHide: true, timeout: CLI_TIMEOUT, maxBuffer: 1024, signal });
    return true;
  } catch {
    return false;
  }
}
export function gameSocket(port: number): Socket {
  return createConnection({ host: LOOPBACK, port, allowHalfOpen: true });
}

/** Binds preview and game addresses to explicit local interface IPv4 values. */
export async function freePort(address: string): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen({ host: address, port: 0, exclusive: true }, resolve);
  });
  const bound = listener.address();
  await new Promise<void>(resolve => { listener.close(() => resolve()); });
  if (bound === null || typeof bound === 'string') throw new RoomError('ENGINE_START_FAILED');
  return bound.port;
}

interface Gate { port: number; close(): Promise<void> }

/** Private host gateway checks the exact established socket before passing any Minecraft bytes. */
export async function openGateway(authorize: (incoming: Socket, outgoing: Socket) => Promise<boolean>, target: number): Promise<Gate> {
  const sockets = new Set<Socket>();
  const server = createServer({ pauseOnConnect: true, allowHalfOpen: true }, incoming => {
    if (sockets.size >= MAX_CONNECTIONS * 2) {
      incoming.destroy();
      return;
    }
    sockets.add(incoming);
    const outgoing = gameSocket(target);
    outgoing.pause();
    sockets.add(outgoing);
    const close = (): void => { incoming.destroy(); outgoing.destroy(); };
    incoming.once('error', close);
    outgoing.once('error', close);
    let forwarding = false;
    incoming.once('close', () => { sockets.delete(incoming); if (!forwarding) outgoing.destroy(); });
    outgoing.once('close', () => { sockets.delete(outgoing); if (!forwarding) incoming.destroy(); });
    outgoing.setTimeout(CLI_TIMEOUT * 2, close);
    outgoing.once('connect', () => {
      void authorize(incoming, outgoing).then(allowed => {
        if (!allowed || incoming.destroyed || outgoing.destroyed) {
          close();
          return;
        }
        outgoing.removeListener('timeout', close);
        outgoing.setTimeout(0);
        forwarding = true;
        incoming.pipe(outgoing);
        outgoing.pipe(incoming);
      }, close);
    });
  });
  server.on('error', () => { for (const socket of sockets) socket.destroy(); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: LOOPBACK, port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new RoomError('ENGINE_START_FAILED');
  return { port: address.port, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  } };
}

function encodeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  do {
    const part = value & 0x7f;
    value >>>= 7;
    bytes.push(part | (value ? 0x80 : 0));
  } while (value);
  return Buffer.from(bytes);
}
function decodeVarInt(source: Buffer, start: number): [number, number] | undefined {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    const byte = source[start + index];
    if (byte === undefined) return undefined;
    value |= (byte & 0x7f) << (index * 7);
    if (!(byte & 0x80)) return [value, start + index + 1];
  }
  throw new RoomError('GAME_PORT_UNVERIFIED');
}
function isMinecraftStatus(bytes: Buffer): boolean {
  const outerLength = decodeVarInt(bytes, 0);
  if (!outerLength || bytes.length < outerLength[0] + outerLength[1]) return false;
  const id = decodeVarInt(bytes, outerLength[1]);
  const length = id && decodeVarInt(bytes, id[1]);
  if (id?.[0] !== 0 || !length || length[0] < 2 || length[1] + length[0] !== outerLength[0] + outerLength[1]) return false;
  const value: unknown = JSON.parse(bytes.subarray(length[1], length[1] + length[0]).toString('utf8'));
  return typeof value === 'object' && value !== null && 'version' in value && 'description' in value;
}

/** Confirms an end-to-end Java Edition status response before showing a forwarding address. */
export async function probeMinecraft(port: number, signal: AbortSignal, verify?: (clientPort: number) => Promise<boolean>): Promise<boolean> {
  if (signal.aborted) return false;
  return new Promise<boolean>(resolve => {
    const socket = gameSocket(port);
    let bytes = Buffer.alloc(0);
    const finish = (result: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      socket.destroy();
      resolve(result);
    };
    const abort = (): void => finish(false);
    const timer = setTimeout(abort, 2500);
    signal.addEventListener('abort', abort, { once: true });
    socket.on('error', abort);
    socket.once('end', abort);
    socket.once('close', abort);
    socket.once('connect', () => {
      const clientPort = socket.localPort;
      void (verify && clientPort ? verify(clientPort) : Promise.resolve(!verify)).then(allowed => {
        if (!allowed || socket.destroyed || signal.aborted) {
          abort();
          return;
        }
        const target = Buffer.from(LOOPBACK);
        const addressPort = Buffer.alloc(2);
        addressPort.writeUInt16BE(port);
        const handshake = Buffer.concat([Buffer.from([0]), encodeVarInt(0xffffffff), encodeVarInt(target.length), target, addressPort, Buffer.from([1])]);
        socket.write(Buffer.concat([encodeVarInt(handshake.length), handshake, Buffer.from([1, 0])]));
      }, abort);
    });
    socket.on('data', chunk => {
      if (bytes.length + chunk.length > 64 * 1024) { abort(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      try { if (isMinecraftStatus(bytes)) finish(true); } catch { abort(); }
    });
  });
}


const PROOF_HEADER = Buffer.from('OUCL-MINECRAFT-ROOM-1');
function readFixed(socket: Socket, count: number): Promise<Buffer | undefined> {
  return new Promise(resolve => {
    const finish = (value?: Buffer): void => {
      clearTimeout(timer);
      socket.removeListener('readable', read);
      socket.removeListener('close', failed);
      socket.removeListener('end', failed);
      socket.removeListener('error', failed);
      resolve(value);
    };
    const failed = (): void => finish();
    const read = (): void => {
      const value = socket.read(count) as Buffer | null;
      if (value?.length === count) finish(value);
      else if (value) failed();
    };
    const timer = setTimeout(failed, 2000);
    socket.on('readable', read);
    socket.on('close', failed);
    socket.on('error', failed);
    socket.on('end', failed);
    if (socket.destroyed) failed();
    else read();
  });
}
/** Signs a fresh room handshake after checking the exact owned Minecraft socket. */
export async function acceptGuestProof(socket: Socket, key: KeyObject, authorize: () => Promise<boolean>): Promise<boolean> {
  const challenge = await readFixed(socket, PROOF_HEADER.length + 32);
  if (!challenge || !challenge.subarray(0, PROOF_HEADER.length).equals(PROOF_HEADER) || !await authorize() || socket.destroyed) return false;
  socket.write(sign(null, challenge, key));
  return true;
}
/** Requires the invited host's signature before sending any Minecraft protocol bytes. */
export async function verifyRoomHost(socket: Socket, hostProof: string): Promise<boolean> {
  const key = createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: hostProof } });
  const challenge = Buffer.concat([PROOF_HEADER, randomBytes(32)]);
  socket.write(challenge);
  const answer = await readFixed(socket, 64);
  return !!answer && verify(null, challenge, key, answer);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function isPeerId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}
function ipv4(value: unknown): string {
  if (typeof value === 'string') return value.split('/')[0] ?? '';
  const address = object(object(value)?.address)?.addr;
  return isPeerId(address) ? [address >>> 24, address >>> 16 & 255, address >>> 8 & 255, address & 255].join('.') : '';
}
function pinnedTunnel(pair: Record<string, unknown>, hostKey: string): string | undefined {
  const peer = object(pair.peer);
  if (!Array.isArray(peer?.conns)) return undefined;
  for (const connection of peer.conns.slice(0, 16)) {
    const info = object(connection);
    if (!info || info.is_closed === true || !Array.isArray(info.noise_remote_static_pubkey)
      || info.noise_remote_static_pubkey.length !== 32 || !info.noise_remote_static_pubkey.every((byte: unknown) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)
      || Buffer.from(info.noise_remote_static_pubkey).toString('base64') !== hostKey) continue;
    const remote = object(object(info.tunnel)?.remote_addr)?.url;
    if (typeof remote === 'string') return remote;
  }
  return undefined;
}

export interface EngineObservation { ready: boolean; members: RoomMember[]; transport: Transport; hasHost: boolean }
export function readPeerObservation(summary: unknown, routes: unknown, invitation: Invitation, role: 'host' | 'guest'): EngineObservation {
  if (!Array.isArray(summary) || summary.length > 129 || !Array.isArray(routes) || routes.length > 128) {
    throw new RoomError('ENGINE_START_FAILED');
  }
  const local = summary.map(object).find(row => row?.cost === 'Local');
  const ownId = typeof local?.id === 'string' && /^\d{1,10}$/.test(local.id) ? Number(local.id) : undefined;
  if (!isPeerId(ownId) || !ipv4(local?.ipv4).startsWith('198.51.100.')) throw new RoomError('ENGINE_START_FAILED');
  const hostAddress = '198.51.100.' + invitation.roomSubnet.toString();
  const members = new Map<number, RoomMember>([[ownId, { id: ownId, host: role === 'host' }]]);
  let transport: Transport = 'unknown';
  let hasHost = role === 'host';
  for (const row of routes as unknown[]) {
    const pair = object(row);
    const route = object(pair?.route);
    if (!pair || !route || !isPeerId(route.peer_id) || object(route.feature_flag)?.is_public_server === true
      || !ipv4(route.ipv4_addr).startsWith('198.51.100.')) continue;
    const host = ipv4(route.ipv4_addr) === hostAddress;
    if (host && role === 'guest') {
      if (hasHost) throw new RoomError('ROOM_UNAVAILABLE');
      if (route.cost === 1) {
        const tunnel = pinnedTunnel(pair, invitation.hostKey);
        if (!tunnel) continue;
        transport = invitation.lan && tunnel === 'tcp://' + invitation.lan.address + ':' + invitation.lan.port.toString() ? 'lan' : 'direct';
      } else if (typeof route.cost === 'number' && route.cost > 1 && invitation.relayId) {
        transport = 'relay';
      } else {
        continue;
      }
      hasHost = true;
    }
    if (members.size < 32) members.set(route.peer_id, { id: route.peer_id, host });
  }
  return { ready: true, members: [...members.values()], transport, hasHost };
}

export interface EngineProcess {
  ended: Promise<void>;
  policy(): Promise<boolean>;
  observe(): Promise<EngineObservation>;
  close(): Promise<void>;
}
export async function startEngine(helper: string, workspace: string, name: string, toml: string, key: string,
  invitation: Invitation, role: 'host' | 'guest', signal: AbortSignal): Promise<EngineProcess> {
  const rpc = await freePort(LOOPBACK);
  if (signal.aborted) throw new RoomError('CANCELLED');
  const core = engineExecutable(workspace, 'core');
  const cli = engineExecutable(workspace, 'cli');
  const args = ['run', core, rpc.toString()];
  const child = spawn(helper, args, { cwd: path.dirname(core), windowsHide: true,
    env: { ...limitedEnvironment(), ET_LOCAL_PRIVATE_KEY: key }, stdio: ['pipe', 'ignore', 'ignore'] });
  const pipe = child.stdin;
  pipe.on('error', () => undefined);
  const ended = new Promise<void>(resolve => {
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
  const config = Buffer.from(toml);
  const length = Buffer.alloc(4);
  length.writeInt32BE(config.length);
  pipe.write(Buffer.concat([length, config]), () => config.fill(0));
  async function command(...subcommand: string[]): Promise<unknown> {
    const { stdout } = await exec(cli, ['-p', LOOPBACK + ':' + rpc.toString(), '-n', name, '-o', 'json', ...subcommand], {
      cwd: path.dirname(cli), env: limitedEnvironment(), windowsHide: true, timeout: CLI_TIMEOUT, maxBuffer: 256 * 1024, encoding, signal,
    });
    return JSON.parse(stdout) as unknown;
  }
  return {
    ended,
    async policy() {
      const response = await command('port-forward', 'list');
      const rules = object(response)?.cfgs;
      return Array.isArray(rules) && rules.length === (role === 'host' ? 0 : 1);
    },
    async observe() {
      // v2.6.4 uses separate summary and verbose schemas for self identity and raw routes.
      const [summary, routes] = await Promise.all([command('peer', 'list'), command('--verbose', 'peer', 'list')]);
      return readPeerObservation(summary, routes, invitation, role);
    },
    async close() {
      pipe.end();
      const timer = setTimeout(() => child.kill(), 1500);
      try { await ended; } finally { clearTimeout(timer); }
    },
  };
}
