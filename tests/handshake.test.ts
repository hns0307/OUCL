import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHandshakeRequest, isHandshakeResult } from '../src/shared/contracts/handshake.js';
import { isTrustedDocument, negotiateHandshake } from '../src/ipc/handshake.js';

const id = '00000000-0000-4000-8000-000000000001';
const session = '00000000-0000-4000-8000-000000000002';
const trace = '00000000-0000-4000-8000-000000000003';
const request = { contractVersion: 1, requestId: id, payload: { supportedVersions: [1] } };

test('handshake only accepts strict request DTO and safe version integers', () => {
  assert.ok(isHandshakeRequest(request));
  for (const invalid of [null, [], {}, { ...request, extra: true }, { ...request, requestId: '../file' },
    { ...request, contractVersion: 2 }, { ...request, payload: { supportedVersions: [1], extra: true } },
    ...[[], [0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], ['1'], [1,2,3,4,5]].map(supportedVersions => ({ ...request, payload: { supportedVersions } }))]) {
    assert.equal(isHandshakeRequest(invalid), false);
  }
});
test('trusted handshake negotiates version with zero business capabilities', () => {
  const result = negotiateHandshake(request, true, session, trace);
  assert.deepEqual(result, { contractVersion: 1, requestId: id, ok: true, data: { selectedVersion: 1, capabilities: [], sessionId: session } });
  assert.ok(isHandshakeResult(result, id));
});
test('handshake validates implemented capabilities including loaders and still rejects duplicates or unknown APIs', () => {
  const result = negotiateHandshake(request, true, session, trace, ['roots.v1', 'catalog.v1', 'instances.v1', 'tasks.v1', 'loaders.v1']);
  assert.equal(isHandshakeResult(result, id), true);
  if (!result.ok) assert.fail('expected handshake success');
  assert.equal(isHandshakeResult({ ...result, data: { ...result.data, capabilities: ['roots.v1', 'roots.v1'] } }, id), false);
  assert.equal(isHandshakeResult({ ...result, data: { ...result.data, capabilities: ['instances.v1', 'game:not-implemented'] } }, id), false);
});
test('untrusted sender, incompatible version and malformed input return redacted failures', () => {
  for (const [input, trusted, code] of [[request, false, 'INVALID_SENDER'], [{ ...request, payload: { supportedVersions: [2] } }, true, 'UNSUPPORTED_CONTRACT'], [{ secret: 'must-not-leak' }, true, 'INVALID_ARGUMENT']] as const) {
    const result = negotiateHandshake(input, trusted, session, trace);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code);
    assert.ok(!JSON.stringify(result).includes('must-not-leak'));
    assert.ok(!JSON.stringify(result).includes('stack'));
  }
});
test('sender requires exact URL, same contents and main frame', () => {
  const expected = 'file:///application/index.html';
  assert.ok(isTrustedDocument(expected, expected, true, true));
  for (const url of [expected + '?x=1', expected + '.evil', 'https://example.com/']) assert.equal(isTrustedDocument(url, expected, true, true), false);
  assert.equal(isTrustedDocument(expected, expected, false, true), false);
  assert.equal(isTrustedDocument(expected, expected, true, false), false);
});
test('response rejects mismatched request identity and injected capabilities', () => {
  const result = negotiateHandshake(request, true, session, trace);
  assert.equal(isHandshakeResult(result, trace), false);
  assert.equal(isHandshakeResult({ ...result, extra: true }, id), false);
  assert.equal(isHandshakeResult({ contractVersion: 1, requestId: id, ok: true, data: { selectedVersion: 1, capabilities: ['download'], sessionId: session } }, id), false);
  const failure = negotiateHandshake(request, false, session, trace);
  assert.ok(isHandshakeResult(failure, id));
  if (!failure.ok) assert.equal(isHandshakeResult({ ...failure, error: { ...failure.error, stack: 'secret' } }, id), false);
});

test('a well-formed future envelope reports unsupported major and retains request identity', () => {
  const result = negotiateHandshake({ ...request, contractVersion: 2 }, true, session, trace);
  assert.equal(result.requestId, id);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'UNSUPPORTED_CONTRACT');
  assert.ok(isHandshakeResult(result, id));
});
