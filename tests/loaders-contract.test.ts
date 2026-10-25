import assert from 'node:assert/strict';
import test from 'node:test';
import { isInstanceLoaderIdentity, isInstanceV2Summary } from '../src/shared/contracts/instances-v2.js';
import { isLoaderData, isLoaderPayload, isLoaderResult, loaderFailure } from '../src/shared/contracts/loaders.js';
import type { LoaderChannel, LoaderCode, LoaderPayloads } from '../src/shared/contracts/loaders.js';

const id = '00000000-0000-4000-8000-000000000001';
const trace = '00000000-0000-4000-8000-000000000002';
const payloads: LoaderPayloads = {
  'loaders:versions': { minecraftVersion: '1.20.1', loader: 'fabric' },
  'loaders:create': { rootId: id, minecraftVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.20.1', displayName: 'Fabric 生存', isolation: 'on' }
};

test('loaders.v1 accepts controlled identities and rejects paths, URLs and extra fields', () => {
  for (const channel of Object.keys(payloads) as LoaderChannel[]) {
    assert.equal(isLoaderPayload(payloads[channel], channel), true);
    for (const value of [null, [], { ...payloads[channel], path: 'D:/private' }, { ...payloads[channel], url: 'https://example.invalid' }]) {
      assert.equal(isLoaderPayload(value, channel), false);
    }
  }
  assert.equal(isLoaderPayload({ minecraftVersion: '../1.20.1', loader: 'fabric' }, 'loaders:versions'), false);
  assert.equal(isLoaderPayload({ ...payloads['loaders:create'], loaderVersion: 'x/y' }, 'loaders:create'), false);
});

test('loaders.v1 validates bounded unique version output and fixed safe errors', () => {
  const data = { items: [{ loaderVersion: '0.20.1', stable: true, support: 'verified' }] };
  assert.equal(isLoaderData(data, 'loaders:versions'), true);
  assert.equal(isLoaderData({ items: [...data.items, ...data.items] }, 'loaders:versions'), false);
  assert.equal(isLoaderData({ items: [{ ...data.items[0], sourceUrl: 'private' }] }, 'loaders:versions'), false);
  assert.equal(isLoaderData({ taskId: id }, 'loaders:create'), true);
  const codes: LoaderCode[] = ['INVALID_ARGUMENT', 'UNSUPPORTED_CONTRACT', 'INVALID_SENDER', 'TIMEOUT', 'UNAVAILABLE',
    'NETWORK_FAILED', 'UNTRUSTED_METADATA', 'VERSION_UNSUPPORTED', 'ROOT_UNAVAILABLE', 'NAME_CONFLICT', 'INSTALL_FAILED', 'NEEDS_RECOVERY'];
  for (const code of codes) {
    const result = loaderFailure<'loaders:create'>(id, code, trace);
    assert.equal(isLoaderResult(result, id, 'loaders:create'), true);
    assert.equal(isLoaderResult({ ...result, details: 'private' }, id, 'loaders:create'), false);
  }
});

test('instances.v2 distinguishes vanilla and pinned loader identities without leaking storage facts', () => {
  assert.equal(isInstanceLoaderIdentity({ kind: 'vanilla' }), true);
  assert.equal(isInstanceLoaderIdentity({ kind: 'vanilla', version: 'none' }), false);
  assert.equal(isInstanceLoaderIdentity({ kind: 'quilt', version: '0.29.2' }), true);
  const summary = { instanceId: id, displayName: 'Quilt 实例', minecraftVersion: '1.20.1', loader: { kind: 'quilt', version: '0.29.2' },
    isolation: 'on', state: 'ready', revision: 3 };
  assert.equal(isInstanceV2Summary(summary), true);
  assert.equal(isInstanceV2Summary({ ...summary, rootId: id }), false);
  assert.equal(isInstanceV2Summary({ ...summary, loader: { kind: 'forge' } }), false);
  assert.equal(isInstanceV2Summary({ ...summary, isolation: 'inherit' }), false);
});
