import { exactObject, UUID_PATTERN } from './handshake.js';

export const MULTIPLAYER_CAPABILITY = 'multiplayer.v1' as const;
export const MULTIPLAYER_CHANNEL = 'multiplayer:request' as const;
export const MULTIPLAYER_ENGINE_VERSION = '2.6.4';
export const ROOM_CODES = [
  'INVALID_ARGUMENT', 'INVALID_SENDER', 'UNSUPPORTED_CONTRACT', 'UNAVAILABLE', 'UNSUPPORTED_PLATFORM',
  'ENGINE_REQUIRED', 'ENGINE_INVALID', 'ENGINE_START_FAILED', 'ROOM_BUSY', 'SESSION_UNAVAILABLE',
  'GAME_PORT_UNVERIFIED', 'INVITE_INVALID', 'RELAY_REQUIRED', 'NO_AUTHORIZED_ROUTE', 'ROOM_UNAVAILABLE',
  'HOST_DISCONNECTED', 'CANCELLED', 'TIMEOUT',
] as const;
export type RoomCode = typeof ROOM_CODES[number];
export interface MultiplayerRelay { address: string; publicKey: string; stun: string }
export interface LanGame { sessionId: string; instanceId: string; detectedPort?: number }
export type Transport = 'lan' | 'direct' | 'relay' | 'unknown';
export interface RoomMember { id: number; host: boolean }
export interface RoomSnapshot {
  id: string;
  role: 'host' | 'guest';
  phase: 'starting' | 'waiting' | 'connected' | 'reconnecting' | 'failed';
  transport: Transport;
  members: RoomMember[];
  localPort?: number;
  gamePort?: number;
  problem?: RoomCode;
}
export interface MultiplayerSnapshot {
  supported: boolean;
  engineInstalled: boolean;
  relay: MultiplayerRelay | null;
  games: LanGame[];
  room: RoomSnapshot | null;
}
export type MultiplayerInput = { action: 'snapshot' | 'importEngine' | 'leave' | 'invite' }
  | { action: 'host'; sessionId: string; port?: number }
  | { action: 'join'; invite: string }
  | { action: 'configure'; relay: MultiplayerRelay | null };
export interface MultiplayerRequest { contractVersion: 1; requestId: string; payload: MultiplayerInput }
export type MultiplayerResult = { contractVersion: 1; requestId: string; ok: true; data: MultiplayerSnapshot; invite?: string }
  | { contractVersion: 1; requestId: string; ok: false; error: { code: RoomCode; traceId: string } };
export interface MultiplayerBridge { multiplayer(input: MultiplayerInput): Promise<MultiplayerResult> }

const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function optional(value: unknown, required: string[], extras: string[]): value is Record<string, unknown> {
  return record(value) && exactObject(value, [...required, ...extras.filter(key => Object.hasOwn(value, key))]);
}
export const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
export const isRoomCode = (value: unknown): value is RoomCode => ROOM_CODES.some(code => code === value);
export const isInviteText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 1024 && /^oucl1\.[A-Za-z0-9_-]+$/.test(value);

export function isRelay(value: unknown): value is MultiplayerRelay {
  return exactObject(value, ['address', 'publicKey', 'stun']) && typeof value.address === 'string'
    && value.address.length <= 270 && /^tcp:\/\/[A-Za-z0-9.-]+:[0-9]{1,5}$/.test(value.address)
    && isPort(Number(value.address.slice(value.address.lastIndexOf(':') + 1)))
    && typeof value.publicKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value.publicKey)
    && typeof value.stun === 'string' && (value.stun === '' || value.stun.length <= 260
      && /^[A-Za-z0-9.-]+:[0-9]{1,5}$/.test(value.stun) && isPort(Number(value.stun.slice(value.stun.lastIndexOf(':') + 1))));
}
export function isMultiplayerInput(value: unknown): value is MultiplayerInput {
  if (!record(value)) return false;
  switch (value.action) {
    case 'snapshot':
    case 'importEngine':
    case 'leave':
    case 'invite': return exactObject(value, ['action']);
    case 'host': return optional(value, ['action', 'sessionId'], ['port']) && uuid(value.sessionId)
      && (!Object.hasOwn(value, 'port') || isPort(value.port));
    case 'join': return exactObject(value, ['action', 'invite']) && isInviteText(value.invite);
    case 'configure': return exactObject(value, ['action', 'relay']) && (value.relay === null || isRelay(value.relay));
    default: return false;
  }
}
export function isMultiplayerRequest(value: unknown): value is MultiplayerRequest {
  return exactObject(value, ['contractVersion', 'requestId', 'payload'])
    && value.contractVersion === 1 && uuid(value.requestId) && isMultiplayerInput(value.payload);
}

function isRoom(value: unknown): value is RoomSnapshot {
  return optional(value, ['id', 'role', 'phase', 'transport', 'members'], ['localPort', 'gamePort', 'problem']) && uuid(value.id)
    && (value.role === 'host' || value.role === 'guest')
    && ['starting', 'waiting', 'connected', 'reconnecting', 'failed'].some(phase => phase === value.phase)
    && ['lan', 'direct', 'relay', 'unknown'].some(transport => transport === value.transport)
    && Array.isArray(value.members) && value.members.length <= 32 && value.members.every((member: unknown) =>
      exactObject(member, ['id', 'host']) && typeof member.id === 'number' && Number.isInteger(member.id)
      && member.id >= 0 && member.id <= 0xffffffff && typeof member.host === 'boolean')
    && (!Object.hasOwn(value, 'localPort') || isPort(value.localPort))
    && (!Object.hasOwn(value, 'gamePort') || isPort(value.gamePort))
    && (!Object.hasOwn(value, 'problem') || isRoomCode(value.problem));
}
export function isMultiplayerResult(value: unknown, request: MultiplayerRequest): value is MultiplayerResult {
  if (!record(value) || value.requestId !== request.requestId || value.contractVersion !== 1) return false;
  if (value.ok === false) return exactObject(value, ['contractVersion', 'requestId', 'ok', 'error'])
    && exactObject(value.error, ['code', 'traceId']) && isRoomCode(value.error.code) && uuid(value.error.traceId);
  if (value.ok !== true || !optional(value, ['contractVersion', 'requestId', 'ok', 'data'], ['invite'])) return false;
  if (request.payload.action === 'invite' ? !isInviteText(value.invite) : Object.hasOwn(value, 'invite')) return false;
  const data = value.data;
  return exactObject(data, ['supported', 'engineInstalled', 'relay', 'games', 'room'])
    && typeof data.supported === 'boolean' && typeof data.engineInstalled === 'boolean' && (data.relay === null || isRelay(data.relay))
    && Array.isArray(data.games) && data.games.length <= 32 && data.games.every((game: unknown) =>
      optional(game, ['sessionId', 'instanceId'], ['detectedPort']) && uuid(game.sessionId) && uuid(game.instanceId)
      && (!Object.hasOwn(game, 'detectedPort') || isPort(game.detectedPort)))
    && (data.room === null || isRoom(data.room));
}
