import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NativeExtractor } from '../src/services/workers/native-extractor.js';
import { parseNativeRequest, parseNativeReply } from '../src/services/workers/native-protocol.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
async function fixture(work: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-native-worker-'));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('native worker schemas reject scripts, unknown keys, unsafe limits and unbounded replies', () => {
  const request = { version: 1, kind: 'native-extract', destination: path.resolve('fixture'), archives: [] };
  assert.deepEqual(parseNativeRequest(request), request);
  for (const value of [{ ...request, script: 'anything' }, { ...request, destination: 'relative' }, { ...request, archives: Array(65).fill({}) },
    { ...request, archives: [{ file: path.resolve('file'), sha256: 'a'.repeat(64), size: 1, exclude: [], script: 'anything' }] }]) assert.throws(() => parseNativeRequest(value));
  assert.deepEqual(parseNativeReply({ version: 1, kind: 'native-result', files: 0, bytes: 0 }), { version: 1, kind: 'native-result', files: 0, bytes: 0 });
  for (const value of [{ version: 1, kind: 'native-result', files: 4097, bytes: 0 }, { version: 1, kind: 'native-result', files: 0, bytes: 256 * 1024 * 1024 + 1 },
    { version: 1, kind: 'native-failed', code: 'PRIVATE_OS_ERROR' }, { version: 1, kind: 'native-failed', code: 'ARCHIVE_IO', path: 'PRIVATE_PATH' }]) assert.throws(() => parseNativeReply(value));
});

test('real one-shot worker releases its directory and rejects occupied output without leaking paths', async () => fixture(async root => {
  const destination = path.join(root, 'staging'); await mkdir(destination); const extractor = new NativeExtractor(entry);
  try {
    assert.deepEqual(await extractor.run(destination, []), { files: 0, bytes: 0 });
    await writeFile(path.join(destination, 'private.txt'), 'owned');
    await assert.rejects(extractor.run(destination, []), { code: 'UNSAFE_ARCHIVE', message: 'UNSAFE_ARCHIVE' });
    await rm(destination, { recursive: true });
  } finally { await extractor.close(); }
}));

test('native extraction admission is bounded and active cancellation joins before staging removal', async () => fixture(async root => {
  const destination = path.join(root, 'staging'); await mkdir(destination); const extractor = new NativeExtractor(entry); const controller = new AbortController();
  try {
    const work = extractor.run(destination, [], { signal: controller.signal });
    const rejected = assert.rejects(work, { code: 'CANCELLED' });
    await assert.rejects(extractor.run(destination, []), { code: 'EXTRACTION_BUSY' }); controller.abort(); await rejected;
    await rm(destination, { recursive: true }); await mkdir(destination);
    assert.deepEqual(await extractor.run(destination, []), { files: 0, bytes: 0 });
    await assert.rejects(extractor.run(destination, [], { signal: AbortSignal.abort() }), { code: 'CANCELLED' });
  } finally { await extractor.close(); }
}));

test('close joins a running extraction and prevents admission, timeout and malformed archives stay fixed', async () => fixture(async root => {
  const destination = path.join(root, 'staging'); await mkdir(destination); const extractor = new NativeExtractor(entry);
  const work = assert.rejects(extractor.run(destination, []), { code: 'CANCELLED' }); await extractor.close(); await work;
  await assert.rejects(extractor.run(destination, []), { code: 'WORKER_FAILED' });
  const timeout = new NativeExtractor(entry, 1);
  try { await assert.rejects(timeout.run(destination, []), { code: 'EXTRACTION_TIMEOUT' }); } finally { await timeout.close(); }
  const file = path.join(root, 'invalid.jar'); const bytes = Buffer.from('invalid'); await writeFile(file, bytes);
  const invalid = new NativeExtractor(entry);
  try { await assert.rejects(invalid.run(destination, [{ file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), exclude: [] }]), { code: 'INVALID_ARCHIVE' }); }
  finally { await invalid.close(); }
}));
