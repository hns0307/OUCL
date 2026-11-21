import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { handleSkin } from '../src/ipc/skin.js';
import { SkinContractError } from '../src/shared/contracts/skin.js';
import { skinHttpsUrl } from '../src/services/skin/http.js';
import { validateSkinPng } from '../src/services/skin/provider.js';
import { SkinService } from '../src/services/skin/service.js';
import type { SkinHttpResponse, SkinTransport } from '../src/services/skin/http.js';
import type { SkinSecretStorage } from '../src/services/skin/service.js';

const ROLE = { id: 'aabbccddeeff412395574433221100ff', name: 'ExampleRole' };
const OTHER = { id: 'babbccddeeff412395574433221100ff', name: 'OtherRole' };
const ROOT = 'https://auth.example.org/api/yggdrasil/';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const METADATA = { meta: { serverName: 'Example Skin', implementationName: 'Yggdrasil API for Blessing Skin', links: { homepage: 'https://skin.example.org/' } },
  skinDomains: ['cdn.example.org'], signaturePublickey: key.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
function response(status: number, body?: unknown, headers?: Record<string, string>): SkinHttpResponse {
  return { status, body: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)), headers: new Headers(headers) };
}
function pngChunk(kind: string, bytes: Buffer): Buffer {
  const type = Buffer.from(kind); const chunk = Buffer.alloc(bytes.length + 12);
  chunk.writeUInt32BE(bytes.length); type.copy(chunk, 4); bytes.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
function texturePng(): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(64); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(64 * (64 * 4 + 1), 0);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
function vault(): SkinSecretStorage {
  const keyMaterial = randomBytes(32);
  return {
    encrypt: async text => {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyMaterial, iv);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decrypt: async bytes => {
      const decipher = createDecipheriv('aes-256-gcm', keyMaterial, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
function profileResponse() {
  const value = Buffer.from(JSON.stringify({ profileId: ROLE.id, textures: {
    SKIN: { url: 'https://cdn.example.org/verified.png', metadata: { model: 'slim' } },
  } })).toString('base64');
  const signature = sign('RSA-SHA1', Buffer.from(value), key.privateKey).toString('base64');
  return { ...ROLE, properties: [{ name: 'textures', value, signature }, { name: 'uploadableTextures', value: 'skin' }] };
}

test('ALI discovery, role selection, encrypted rotation, verified textures, upload receipt and logout use a single confirmed site', async t => {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(parent, 'oucl-skin-'));
  t.after(async () => { assert.equal(path.dirname(directory), parent); await rm(directory, { recursive: true, force: true }); });
  const secrets = vault();
  const png = texturePng();
  const requests: string[] = [];
  let rotated = false;
  let uploaded = false;
  let clientToken = '';
  const send: SkinTransport = async (url, options) => {
    requests.push((options.method ?? 'GET') + ' ' + url.href);
    if (url.href === 'https://skin.example.org/')
      return response(200, undefined, { 'x-authlib-injector-api-location': ROOT });
    if (url.href === ROOT) return response(200, METADATA);
    if (url.href === 'https://cdn.example.org/verified.png') {
      assert.equal(options.headers?.authorization, undefined);
      return { status: 200, body: png, headers: new Headers({ 'content-type': 'image/png' }) };
    }
    assert.equal(url.origin, 'https://auth.example.org');
    switch (url.pathname.slice(new URL(ROOT).pathname.length)) {
      case 'authserver/authenticate': {
        const body = JSON.parse(options.body!.toString());
        assert.equal(body.password, 'never-store-this-password');
        clientToken = body.clientToken;
        return response(200, { accessToken: 'unbound-token', clientToken, availableProfiles: [ROLE, OTHER] });
      }
      case 'authserver/refresh': {
        const body = JSON.parse(options.body!.toString());
        assert.equal(body.clientToken, clientToken);
        if (body.accessToken === 'unbound-token') {
          assert.deepEqual(body.selectedProfile, ROLE);
          return response(200, { accessToken: 'role-token', clientToken, selectedProfile: ROLE });
        }
        assert.equal(body.accessToken, 'role-token');
        assert.equal(body.selectedProfile, undefined);
        rotated = true;
        return response(200, { accessToken: 'rotated-token', clientToken, selectedProfile: ROLE });
      }
      case 'authserver/validate': return response(403);
      case 'authserver/invalidate': {
        const body = JSON.parse(options.body!.toString());
        assert.equal(body.accessToken, 'rotated-token');
        return response(204);
      }
      case 'sessionserver/session/minecraft/profile/' + ROLE.id: return uploaded ? response(503) : response(200, profileResponse());
      case 'api/user/profile/' + ROLE.id + '/skin':
        assert.equal(options.method, 'PUT');
        assert.equal(options.headers?.authorization, 'Bearer rotated-token');
        assert.ok(options.body?.includes(png));
        uploaded = true;
        return response(204);
      default: throw new Error('Unexpected fixture route ' + url.pathname);
    }
  };
  const service = new SkinService({ directory, secrets, transport: send, openExternal: async () => {} });
  t.after(() => service.close());
  const proposed = await service.discover('skin.example.org');
  assert.equal(proposed.provider.adapter, 'blessing');
  assert.equal(proposed.provider.apiRoot, ROOT);
  assert.equal((await service.list()).providers.length, 0);
  const site = await service.addProvider(proposed.discoveryId);
  const result = await service.login({ providerId: site.providerId, username: 'user@example.org', password: 'never-store-this-password' });
  assert.equal(result.state, 'select');
  if (result.state !== 'select') throw new Error('Missing role selection');
  assert.equal((await service.listAccounts()).length, 0);
  const forged = await handleSkin('skin:selectRole', {
    contractVersion: 1, requestId: randomUUID(), payload: { loginId: result.loginId, roleUuid: result.roles[0]!.uuid },
  }, false, randomUUID(), service);
  assert.equal(forged.ok || forged.error.code, 'INVALID_SENDER');
  const chosen = await service.selectRole(result.loginId, result.roles[0]!.uuid);
  assert.equal(chosen.gameName, ROLE.name);
  assert.equal(await service.accountRevision(chosen.accountId), 1);
  assert.equal(await service.verifyLaunchAgent(path.join(directory, 'arbitrary.jar')), false);
  const preview = await service.preview(chosen.accountId);
  assert.equal(preview.model, 'slim');
  assert.equal(preview.uploadSkin, true);
  assert.equal(preview.skin, 'data:image/png;base64,' + png.toString('base64'));
  const upload = await service.upload({ accountId: chosen.accountId, model: 'slim', png });
  assert.deepEqual(upload, { applied: true });
  assert.equal(rotated, true);
  assert.equal(uploaded, true);
  assert.equal(await service.accountRevision(chosen.accountId), 1);
  const serialized = await readFile(path.join(directory, 'skin-center.v1.json'), 'utf8');
  assert.doesNotMatch(serialized, /unbound-token|role-token|rotated-token|user@example\.org|never-store-this-password/);
  assert.deepEqual(await service.logout(chosen.accountId), { revoked: true });
  assert.equal(await service.accountRevision(chosen.accountId), 2);
  assert.equal((await service.listAccounts())[0]?.ready, false);
  assert.equal(requests.filter(item => item.startsWith('PUT ')).length, 1);
});

test('private destinations and corrupt or incomplete textures are rejected', () => {
  for (const url of ['https://127.0.0.1/', 'https://[::ffff:192.168.1.1]/', 'https://[::1]/',
    'https://169.254.169.254/', 'https://foo.localhost/', 'https://user@skin.example.org/', 'http://skin.example.org/']) {
    assert.throws(() => skinHttpsUrl(url), { code: 'INVALID_URL' } satisfies Partial<SkinContractError>);
  }
  const png = texturePng();
  assert.doesNotThrow(() => validateSkinPng(png, 'skin', 'slim'));
  assert.throws(() => validateSkinPng(png.subarray(0, -1), 'skin'), { code: 'INVALID_TEXTURE' });
  assert.throws(() => validateSkinPng(png, 'cape'), { code: 'INVALID_TEXTURE' });
  png[25] = 29;
  assert.throws(() => validateSkinPng(png, 'skin'), { code: 'INVALID_TEXTURE' });
});
