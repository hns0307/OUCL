
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MicrosoftMinecraftApi, MicrosoftError, readJavaLicense, readJavaProfile } from '../src/services/auth/microsoft-api.js';
import type { MinecraftLicense } from '../src/services/auth/microsoft-api.js';
import { MicrosoftAccounts } from '../src/services/auth/microsoft-accounts.js';
import { isOnlineAccountsData } from '../src/shared/contracts/online-accounts.js';

const profile = { id: '2cd823a60d2e4c38b7a5bc1630b10034', name: 'FixtureUser', skins: [], capes: [] };
const privateToken = 'test-minecraft-token';
const license: MinecraftLicense = { entitlement: 'owned', profile: readJavaProfile(profile), accessToken: privateToken, expiresAt: Date.now() + 600_000 };
const auth = { accessToken: 'test-microsoft-token', homeAccountId: 'example.microsoft.home', cache: '{"test":"sensitive-refresh-fixture"}' };

test('Xbox success is followed by a distinct Java entitlement and profile lookup', async () => {
  const calls: { url: URL; content: string; auth: string | null }[] = [];
  const endpoint = new MicrosoftMinecraftApi(async (url, request) => {
    const endpoint = new URL(String(url));
    calls.push({ url: endpoint, content: String(request?.body ?? ''), auth: new Headers(request?.headers).get('authorization') });
    assert.equal(request?.redirect, 'error');
    if (endpoint.hostname.startsWith('user.auth.')) return Response.json({ Token: 'xbl-fixture-access', DisplayClaims: { xui: [{ uhs: '42' }] } });
    if (endpoint.hostname.startsWith('xsts.')) return Response.json({ Token: 'xsts-fixture-access', DisplayClaims: { xui: [{ uhs: '42', xid: '123' }] } });
    if (endpoint.pathname === '/launcher/login') return Response.json({ access_token: privateToken, expires_in: 1200 });
    if (endpoint.pathname === '/entitlements/license') return Response.json({ items: [{ name: 'game_minecraft' }] });
    if (endpoint.pathname === '/minecraft/profile') return Response.json(profile);
    throw new Error('unexpected endpoint');
  });
  const requestId = randomUUID();
  const result = await endpoint.exchange(auth.accessToken, requestId, new AbortController().signal);
  assert.equal(result.entitlement, 'playable');
  assert.equal(result.profile?.gameName, 'FixtureUser');
  assert.equal(result.xuid, '123');
  assert.equal(calls[0]?.auth, null);
  assert.match(calls[1]?.content ?? '', /xbl-fixture-access/);
  assert.match(calls[2]?.content ?? '', /xsts-fixture-access/);
  assert.equal(calls[3]?.auth, 'Bearer ' + privateToken);
  assert.equal(calls[3]?.url.searchParams.get('requestId'), requestId);
  assert.equal(readJavaLicense({ items: [{ name: 'game_bedrock' }] }), 'none');
  assert.throws(() => readJavaLicense({ items: {} }), MicrosoftError);
  assert.equal(readJavaProfile({ ...profile, skins: [{ state: 'ACTIVE', url: 'https://localhost/texture/fake' }] }).skin, undefined);
});

test('encrypted Microsoft cache is bound to its account and sign-out survives reopen', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oucl-online-account-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const key = randomBytes(32);
  const secrets = {
    async encrypt(input: string) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      return Buffer.concat([nonce, cipher.update(input), cipher.final(), cipher.getAuthTag()]);
    },
    async decrypt(bytes: Buffer) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString();
    },
  };
  let current: MinecraftLicense = license;
  const make = (): MicrosoftAccounts => new MicrosoftAccounts(directory, secrets, {
    clientId: randomUUID(), configured: true, async signIn() { return auth; },
    async refresh(previous) { assert.equal(previous.homeAccountId, auth.homeAccountId); return auth; },
  }, { async exchange() { return current; } });
  const primary = make();
  await primary.signIn();
  const [account] = await primary.list();
  assert.ok(account?.ready);
  const bytes = await readFile(path.join(directory, 'microsoft-v1.json'), 'utf8');
  for (const secret of [auth.homeAccountId, auth.cache, privateToken, 'sensitive-refresh-fixture']) assert.ok(!bytes.includes(secret));
  assert.ok(!isOnlineAccountsData({ kind: 'accounts', microsoftConfigured: true, items: [{
    ...account, kind: 'microsoft', displayName: account.gameName, accessToken: privateToken,
  }] }));
  assert.equal((await primary.resolveLaunch(account.accountId, new AbortController().signal))?.accessToken, privateToken);
  primary.close();
  const reopened = make();
  assert.equal((await reopened.list())[0]?.accountId, account.accountId);
  current = { ...license, entitlement: 'none' };
  await assert.rejects(reopened.resolveLaunch(account.accountId, new AbortController().signal), { code: 'NO_LICENSE' });
  assert.equal((await reopened.list())[0]?.ready, false);
  await reopened.signOut(account.accountId);
  reopened.close();
  const signedOut = make();
  assert.deepEqual(await signedOut.list(), []);
  signedOut.close();
});
