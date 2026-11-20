import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { parse } from 'smol-toml';
import { decodeInvite, encodeInvite, engineConfig, newInvitation, roomKeys } from '../src/services/multiplayer/config.js';
import { acceptGuestProof, openGateway, probeMinecraft, readPeerObservation, verifyRoomHost } from '../src/services/multiplayer/transport.js';
import { isMultiplayerInput } from '../src/shared/contracts/multiplayer.js';

test('invites only carry local room facts and an optional separately configured relay fingerprint', () => {
  const node = roomKeys();
  const proof = generateKeyPairSync('ed25519');
  const hostProof = proof.publicKey.export({ format: 'jwk' }).x!;
  const id = randomUUID();
  const invite = newInvitation(id, 51420, node.publicKey, hostProof, { address: '192.168.1.5', port: 51425 },
    { address: 'tcp://my-authorized-relay.example:11010', publicKey: node.publicKey, stun: 'stun.example:3478' });
  const encoded = encodeInvite(invite);
  assert.deepEqual(decodeInvite(encoded), invite);
  assert.equal(encoded.includes('my-authorized-relay'), false);
  assert.throws(() => decodeInvite(encodeInvite({ ...invite, lan: { address: '8.8.8.8', port: 51425 } })), { message: 'INVITE_INVALID' });
  assert.equal(isMultiplayerInput({ action: 'host', sessionId: id, port: 70000 }), false);
  assert.equal(isMultiplayerInput({ action: 'host', sessionId: id, port: 51425, destination: 'whatever' }), false);

  const host = parse(engineConfig({ invitation: invite, role: 'host', relay: null, lan: invite.lan }).toml);
  assert.deepEqual(host.stun_servers, []);
  assert.deepEqual(host.stun_servers_v6, []);
  assert.deepEqual(host.peer, []);
  assert.deepEqual(host.listeners, ['tcp://192.168.1.5:51425']);
  assert.deepEqual(host.port_forward, []);
  const guest = parse(engineConfig({ invitation: invite, role: 'guest', relay: null, lan: invite.lan, localPort: 51426 }).toml);
  assert.deepEqual(JSON.parse(JSON.stringify(guest.port_forward)), [{
    proto: 'tcp', bind_addr: '127.0.0.1:51426', dst_addr: '198.51.100.' + invite.roomSubnet.toString() + ':51420',
  }]);
  assert.equal((guest.flags as Record<string, unknown>).no_tun, true);
  assert.equal((guest.flags as Record<string, unknown>).enable_exit_node, false);
});

test('loopback Minecraft proxy forwards only after an invited host signs and the owner check passes', async () => {
  const proof = generateKeyPairSync('ed25519');
  const wrong = generateKeyPairSync('ed25519');
  const data = Buffer.from(JSON.stringify({ version: {}, description: 'fixture' }));
  let received = 0;
  const target = createServer(socket => {
    socket.once('data', () => {
      received++;
      socket.end(Buffer.concat([Buffer.from([data.length + 2, 0, data.length]), data]));
    });
  });
  await new Promise<void>(resolve => { target.listen(0, '127.0.0.1', resolve); });
  const address = target.address();
  assert(address && typeof address !== 'string');
  let allowed = false;
  const host = await openGateway((incoming, outgoing) => acceptGuestProof(incoming, proof.privateKey, async () =>
    allowed && !!outgoing.localPort), address.port);
  const guest = await openGateway((_incoming, outgoing) => verifyRoomHost(outgoing, proof.publicKey.export({ format: 'jwk' }).x!), host.port);
  const impostor = await openGateway((_incoming, outgoing) => verifyRoomHost(outgoing, wrong.publicKey.export({ format: 'jwk' }).x!), host.port);
  try {
    const signal = new AbortController().signal;
    assert.equal(await probeMinecraft(guest.port, signal), false);
    assert.equal(received, 0);
    allowed = true;
    assert.equal(await probeMinecraft(impostor.port, signal), false);
    assert.equal(received, 0);
    assert.equal(await probeMinecraft(guest.port, signal), true);
    assert.equal(received, 1);
  } finally {
    await Promise.all([guest.close(), impostor.close(), host.close()]);
    await new Promise<void>(resolve => { target.close(() => resolve()); });
  }
});

test('the pinned LAN host is recognized in the configured room overlay', () => {
  const key = roomKeys();
  const proof = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!;
  const invite = newInvitation(randomUUID(), 51420, key.publicKey, proof, { address: '192.168.1.5', port: 51425 }, null);
  const summary = [{ cost: 'Local', id: '1', ipv4: '198.51.100.255' }];
  const route = { route: { peer_id: 2, ipv4_addr: '198.51.100.' + invite.roomSubnet.toString(), cost: 1 },
    peer: { conns: [{ noise_remote_static_pubkey: [...Buffer.from(key.publicKey, 'base64')], tunnel: { remote_addr: { url: 'tcp://192.168.1.5:51425' } } }] } };
  assert.equal(readPeerObservation(summary, [route], invite, 'guest').transport, 'lan');
  assert.equal(readPeerObservation(summary, [route], { ...invite, hostKey: roomKeys().publicKey }, 'guest').hasHost, false);
});
