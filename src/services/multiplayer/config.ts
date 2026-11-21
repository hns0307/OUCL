import { createHash, generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';
import { stringify } from 'smol-toml';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isInviteText, isPort, isRelay } from '../../shared/contracts/multiplayer.js';
import type { MultiplayerRelay, RoomCode } from '../../shared/contracts/multiplayer.js';

export class RoomError extends Error {
  constructor(readonly code: RoomCode) {
    super(code);
    this.name = 'RoomError';
  }
}
interface LanPeer { address: string; port: number }
export interface Invitation {
  id: string;
  password: string;
  roomSubnet: number;
  gateway: number;
  hostKey: string;
  hostProof: string;
  lan: LanPeer | null;
  relayId: string | null;
}
export interface LocalEngineConfig {
  invitation: Invitation;
  role: 'host' | 'guest';
  relay: MultiplayerRelay | null;
  lan: LanPeer | null;
  localPort?: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function normalizeRelay(value: MultiplayerRelay): MultiplayerRelay {
  if (!isRelay(value) || Buffer.from(value.publicKey, 'base64').toString('base64') !== value.publicKey) throw new RoomError('INVALID_ARGUMENT');
  const canonicalAddress = (address: string): string => {
    const split = address.lastIndexOf(':');
    const host = address.slice(0, split).toLowerCase().replace(/\.$/, '');
    if (!host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new RoomError('INVALID_ARGUMENT');
    return host + ':' + Number(address.slice(split + 1)).toString();
  };
  return {
    address: 'tcp://' + canonicalAddress(value.address.slice(6)),
    publicKey: value.publicKey,
    stun: value.stun === '' ? '' : canonicalAddress(value.stun),
  };
}
export const relayIdentity = (relay: MultiplayerRelay): string => digest(JSON.stringify(relay));
export function roomKeys(): { privateKey: string; publicKey: string } {
  const keys = generateKeyPairSync('x25519');
  const key = keys.privateKey.export({ format: 'jwk' });
  if (!key.d || !key.x) throw new RoomError('UNAVAILABLE');
  return { privateKey: Buffer.from(key.d, 'base64url').toString('base64'), publicKey: Buffer.from(key.x, 'base64url').toString('base64') };
}
export function newInvitation(id: string, gateway: number, hostKey: string, hostProof: string, lan: LanPeer | null, relay: MultiplayerRelay | null): Invitation {
  return { id, password: randomBytes(32).toString('base64url'), roomSubnet: randomInt(1, 255), gateway, hostKey, hostProof, lan, relayId: relay ? relayIdentity(relay) : null };
}
export function encodeInvite(invitation: Invitation): string {
  return 'oucl1.' + Buffer.from(JSON.stringify(invitation), 'utf8').toString('base64url');
}
function isPrivateIPv4(address: string): boolean {
  return isIPv4(address) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}
function addressNumber(address: string): number {
  return address.split('.').reduce((number, octet) => ((number << 8) | Number(octet)) >>> 0, 0);
}
function privateInterfaces(): { address: string; netmask: string }[] {
  return Object.values(networkInterfaces()).flatMap(entries => (entries ?? []).filter(entry =>
    entry.family === 'IPv4' && !entry.internal && isPrivateIPv4(entry.address)));
}
export function localLanAddress(): string | undefined {
  return privateInterfaces()[0]?.address;
}
export function isSameLan(address: string): boolean {
  if (!isPrivateIPv4(address)) return false;
  const target = addressNumber(address);
  return privateInterfaces().some(entry => {
    const mask = addressNumber(entry.netmask);
    const local = addressNumber(entry.address);
    const network = (local & mask) >>> 0;
    const broadcast = (network | ~mask) >>> 0;
    return mask !== 0 && ((target & mask) >>> 0) === network && target !== local && target !== network && target !== broadcast;
  });
}
export function decodeInvite(text: string): Invitation {
  try {
    if (!isInviteText(text)) throw new RoomError('INVITE_INVALID');
    const code = text.slice(6);
    const bytes = Buffer.from(code, 'base64url');
    if (bytes.toString('base64url') !== code) throw new RoomError('INVITE_INVALID');
    const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!exactObject(input, ['id', 'password', 'roomSubnet', 'gateway', 'hostKey', 'hostProof', 'lan', 'relayId'])
      || typeof input.id !== 'string' || !UUID_PATTERN.test(input.id)
      || typeof input.password !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.password)
      || typeof input.roomSubnet !== 'number' || !Number.isInteger(input.roomSubnet) || input.roomSubnet < 1 || input.roomSubnet > 254
      || !isPort(input.gateway) || input.gateway < 1024 || typeof input.hostKey !== 'string'
      || !/^[A-Za-z0-9+/]{43}=$/.test(input.hostKey) || Buffer.from(input.hostKey, 'base64').toString('base64') !== input.hostKey
      || typeof input.hostProof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.hostProof)
      || input.relayId !== null && (typeof input.relayId !== 'string' || !/^[0-9a-f]{64}$/.test(input.relayId))) throw new RoomError('INVITE_INVALID');
    let lan: LanPeer | null = null;
    if (input.lan !== null) {
      if (!exactObject(input.lan, ['address', 'port']) || typeof input.lan.address !== 'string'
        || !isPrivateIPv4(input.lan.address) || !isPort(input.lan.port) || input.lan.port < 1024) throw new RoomError('INVITE_INVALID');
      lan = { address: input.lan.address, port: input.lan.port };
    }
    if (!lan && !input.relayId) throw new RoomError('INVITE_INVALID');
    return { id: input.id.toLowerCase(), password: input.password, roomSubnet: input.roomSubnet, gateway: input.gateway,
      hostKey: input.hostKey, hostProof: input.hostProof, lan, relayId: input.relayId };
  } catch {
    throw new RoomError('INVITE_INVALID');
  }
}
export function engineConfig({ invitation, role, relay, lan, localPort }: LocalEngineConfig): { toml: string; name: string; hostAddress: string } {
  const host = role === 'host';
  const name = 'oucl-' + invitation.id;
  const overlay = '198.51.100';
  const hostAddress = overlay + '.' + invitation.roomSubnet.toString();
  const guestOffset = randomInt(1, 254);
  const guestAddress = overlay + '.' + (guestOffset < invitation.roomSubnet ? guestOffset : guestOffset + 1).toString();
  const peer = [];
  if (!host && lan) peer.push({ uri: 'tcp://' + lan.address + ':' + lan.port.toString(), peer_public_key: invitation.hostKey });
  if (relay) peer.push({ uri: relay.address, peer_public_key: relay.publicKey });
  const listeners = host && lan ? ['tcp://' + lan.address + ':' + lan.port.toString()] : [];
  if (relay && relay.stun) listeners.push('udp://0.0.0.0:0');
  const identity = host ? 'oucl-host' : 'oucl-guest-' + randomBytes(4).toString('hex');
  const toml = stringify({
    instance_name: name,
    hostname: identity,
    ipv4: (host ? hostAddress : guestAddress) + '/24',
    dhcp: false,
    listeners,
    stun_servers: relay?.stun ? [relay.stun] : [],
    stun_servers_v6: [],
    peer,
    port_forward: !host && localPort ? [{ proto: 'tcp', bind_addr: '127.0.0.1:' + localPort.toString(),
      dst_addr: hostAddress + ':' + invitation.gateway.toString() }] : [],
    network_identity: { network_name: name, network_secret: invitation.password },
    flags: {
      no_tun: true, enable_encryption: true, enable_ipv6: false, private_mode: true,
      disable_upnp: true, bind_device: false, accept_dns: false, enable_udp_broadcast_relay: false,
      enable_exit_node: false, disable_kcp_input: true, disable_quic_input: true,
      disable_udp_hole_punching: !relay?.stun, disable_tcp_hole_punching: !relay, disable_sym_hole_punching: true,
    },
    acl: { acl_v1: { chains: [
      { name: 'minecraft', chain_type: 1, enabled: true, default_action: 2, rules: host ? [
        { name: 'minecraft-tcp', action: 1, priority: 100, protocol: 1, ports: [invitation.gateway.toString()], enabled: true, stateful: true },
      ] : [] },
      { name: 'subnet', chain_type: 3, enabled: true, default_action: 2, rules: [] },
    ] } },
  });
  return { toml, name, hostAddress };
}
