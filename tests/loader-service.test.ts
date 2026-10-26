import assert from 'node:assert/strict';
import test from 'node:test';
import { LoaderService } from '../src/services/loaders/service.js';

const id = '00000000-0000-4000-8000-000000000001';
test('loader service rechecks official catalog identity before transactional admission', async () => {
  const calls: unknown[][] = []; const service = new LoaderService({ catalog: async (kind, minecraftVersion) => ({
    evidence: { sourceUrl: 'https://official.invalid', sha256: 'a'.repeat(64) },
    items: [{ kind, minecraftVersion, loaderVersion: '0.20.1', loaderCoordinate: 'net.fabricmc:fabric-loader:0.20.1',
      intermediaryCoordinate: 'net.fabricmc:intermediary:1.20.1', stable: true }]
  }) }, { createLoader: async (...args) => { calls.push(args); return { taskId: id }; } });
  const dispatch = service.dispatcher();
  assert.deepEqual(await dispatch('loaders:versions', { loader: 'fabric', minecraftVersion: '1.20.1' }, id),
    { items: [{ loaderVersion: '0.20.1', stable: true, support: 'unverified' }] });
  const input = { rootId: id, minecraftVersion: '1.20.1', loader: 'fabric' as const, loaderVersion: '0.20.1', displayName: 'Fabric', isolation: 'on' as const };
  assert.deepEqual(await dispatch('loaders:create', input, id), { taskId: id }); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [id, { rootId: id, mcVersionId: '1.20.1', displayName: 'Fabric', isolation: 'on', loader: { kind: 'fabric', version: '0.20.1' } }]);
  await assert.rejects(dispatch('loaders:create', { ...input, loaderVersion: '0.20.2' }, id), { code: 'VERSION_UNSUPPORTED' });
});

test('loader service rejects unimplemented Minecraft series before network access', async () => {
  let calls = 0; const service = new LoaderService({ catalog: async () => { calls++; throw new Error('must not call'); } },
    { createLoader: async () => { calls++; return { taskId: id }; } });
  const dispatch = service.dispatcher();
  await assert.rejects(dispatch('loaders:versions', { loader: 'forge', minecraftVersion: '1.21.1' }, id), { code: 'VERSION_UNSUPPORTED' });
  await assert.rejects(dispatch('loaders:create', { rootId: id, loader: 'neoforge', minecraftVersion: '1.20.1', loaderVersion: '21.1.1', displayName: 'NeoForge', isolation: 'on' }, id), { code: 'VERSION_UNSUPPORTED' });
  assert.equal(calls, 0);
});

test('both processor families expose unverified candidates and preserve exact isolated identities', async () => {
  for (const kind of ['forge', 'neoforge'] as const) {
    const minecraftVersion = kind === 'forge' ? '1.20.1' : '1.21.1'; const loaderVersion = kind === 'forge' ? '47.4.28' : '21.1.265';
    let accepted = 0; const service = new LoaderService({ catalog: async () => ({ evidence: { sourceUrl: 'https://official.invalid', sha256: 'a'.repeat(64) },
      items: [{ kind, minecraftVersion, loaderVersion, stable: true }] }) }, { createLoader: async (_request, input) => {
      assert.deepEqual(input.loader, { kind, version: loaderVersion }); assert.equal(input.isolation, 'on'); accepted++; return { taskId: id };
    } });
    const dispatch = service.dispatcher();
    assert.deepEqual(await dispatch('loaders:versions', { loader: kind, minecraftVersion }, id), { items: [{ loaderVersion, stable: true, support: 'unverified' }] });
    const input = { rootId: id, loader: kind, minecraftVersion, loaderVersion, displayName: kind, isolation: 'on' as const };
    assert.deepEqual(await dispatch('loaders:create', input, id), { taskId: id });
    await assert.rejects(dispatch('loaders:create', { ...input, isolation: 'off' }, id), { code: 'INVALID_ARGUMENT' });
    assert.equal(accepted, 1);
  }
});
