import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest } from './fixture.mjs';

/** Official metadata determines the expected hash; transport metadata is ignored. */
function verify(bytes, expected) {
  if (!expected || !/^[a-f0-9]{40}$/.test(expected.sha1)) throw new Error('UNTRUSTED_METADATA');
  if (bytes.length !== expected.size || digest(bytes, 'sha1') !== expected.sha1) throw new Error('HASH_MISMATCH');
  return true;
}

test('S-05: official metadata -> index -> object checks each available digest', () => {
  const object = Buffer.from('fixture asset');
  const expected = { sha1: digest(object, 'sha1'), size: object.length };
  const index = Buffer.from(JSON.stringify(expected));
  const version = Buffer.from(JSON.stringify({ sha1: digest(index, 'sha1'), size: index.length }));
  assert.ok(verify(version, { sha1: digest(version, 'sha1'), size: version.length }));
  assert.ok(verify(index, JSON.parse(version)));
  assert.ok(verify(object, JSON.parse(index)));
});

test('S-05: mirror replacement cannot replace authoritative expected hash', () => {
  const official = Buffer.from('original'); const mirror = Buffer.from('replaced');
  const expected = { sha1: digest(official, 'sha1'), size: official.length };
  assert.equal(official.length, mirror.length);
  assert.throws(() => verify(mirror, expected), /HASH_MISMATCH/);
  assert.throws(() => verify(official, undefined), /UNTRUSTED_METADATA/);
  assert.throws(() => verify(official, { sha1: 'x', size: official.length }), /UNTRUSTED_METADATA/);
});

test('S-05: stale bytes fail against new trusted metadata and wrong size fails', () => {
  const bytes = Buffer.from('sample');
  assert.throws(() => verify(bytes, { sha1: digest('new-value', 'sha1'), size: bytes.length }), /HASH_MISMATCH/);
  assert.throws(() => verify(bytes, { sha1: digest(bytes, 'sha1'), size: bytes.length + 1 }), /HASH_MISMATCH/);
});
