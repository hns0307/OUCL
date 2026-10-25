import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArchiveValidationReply, parseArchiveValidationRequest } from '../src/services/workers/archive-validation-protocol.js';

test('processor archive validation protocol admits only bounded verified files and results', () => {
  const file = process.platform === 'win32' ? 'C:\\stage\\output.jar' : '/stage/output.jar';
  const request = { version: 1 as const, kind: 'processor-output-validate' as const, file, sha256: 'a'.repeat(64), size: 10 };
  assert.deepEqual(parseArchiveValidationRequest(request), request);
  assert.throws(() => parseArchiveValidationRequest({ ...request, file: 'relative.jar' }));
  assert.throws(() => parseArchiveValidationRequest({ ...request, size: 64 * 1024 ** 2 + 1 }));
  assert.equal(parseArchiveValidationReply({ version: 1, kind: 'processor-output-valid', entries: 2, bytes: 20 }).kind, 'processor-output-valid');
  assert.throws(() => parseArchiveValidationReply({ version: 1, kind: 'processor-output-valid', entries: 0, bytes: 0 }));
});
