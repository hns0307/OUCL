import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixedPackPreview } from '../src/core/packs/fixed-preview.js';
import { parseFixedPackReply, parseFixedPackRequest } from '../src/services/packs/fixed-protocol.js';
import { FixedPackReader } from '../src/services/packs/fixed-reader.js';

const root = process.env.OUCL_SOURCE_ROOT ?? process.cwd();
const worker = process.env.OUCL_FIXED_PACK_WORKER;
const sample = path.join(root, 'docs/work-packages/P-E/sample/OUCL-PE-Forge-Smoke-1.0.0.mrpack');
test('fixed preview is unknown and does not grant install permission', () => {
  const result = fixedPackPreview(889);
  assert.equal(result.status, 'unknown'); assert.equal(result.target.isolated, true);
  assert.equal(result.override.layer, 'client-overrides'); assert.throws(() => fixedPackPreview(888));
});
test('protocol rejects paths and forged worker replies', () => {
  assert.throws(() => parseFixedPackRequest({ version: 1, kind: 'fixed-pack-preview', file: 'relative' }));
  assert.throws(() => parseFixedPackReply({ version: 1, kind: 'fixed-pack-result', preview: { ...fixedPackPreview(889), status: 'ready' } }));
  assert.throws(() => parseFixedPackReply({ version: 1, kind: 'fixed-pack-result', preview: { ...fixedPackPreview(889), extra: true } }));
});
test('real worker accepts fixed bytes and rejects a different archive', async t => {
  if (!worker) { t.skip('dedicated worker bundle not provided'); return; }
  const reader = new FixedPackReader(worker); const preview = await reader.preview(sample);
  assert.equal(preview.status, 'unknown'); assert.equal(preview.archive.entries, 3);
  const temp = await mkdtemp(path.join(process.env.OUCL_FIXED_PACK_TMP ?? path.dirname(worker), 'pack-'));
  const invalid = path.join(temp, 'invalid.mrpack'); await writeFile(invalid, Buffer.alloc(1355));
  await assert.rejects(reader.preview(invalid), /INVALID_SAMPLE/);
  const oversized = path.join(temp, 'other.mrpack'); await writeFile(oversized, Buffer.alloc(1356));
  await assert.rejects(reader.preview(oversized), /INVALID_SAMPLE/);
  await assert.rejects(reader.preview(path.join(temp, 'missing.mrpack')), /READ_FAILED/);
  const directory = path.join(temp, 'directory'); await import('node:fs/promises').then(fs => fs.mkdir(directory));
  await assert.rejects(reader.preview(directory), /UNSAFE_PATH/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(reader.preview(sample, aborted.signal), /CANCELLED/);
});
test('worker exit, duplicate messages, cancellation and deadlines are enforced', async t => {
  if (!worker) { t.skip('dedicated worker bundle not provided'); return; }
  const temp = await mkdtemp(path.join(process.env.OUCL_FIXED_PACK_TMP ?? path.dirname(worker), 'worker-'));
  const duplicate = path.join(temp, 'duplicate.cjs'); const hanging = path.join(temp, 'hanging.cjs');
  const failure = path.join(temp, 'failure.cjs');
  const message = JSON.stringify({ version: 1, kind: 'fixed-pack-result', preview: fixedPackPreview(889) });
  await writeFile(duplicate, `const {parentPort}=require('node:worker_threads');parentPort.postMessage(${message});parentPort.postMessage(${message});`);
  await writeFile(hanging, 'setInterval(() => {}, 1000);');
  await writeFile(failure, `const {parentPort}=require('node:worker_threads');parentPort.postMessage(${message});process.exitCode=1;`);
  await assert.rejects(new FixedPackReader(duplicate).preview(sample), /WORKER_FAILED/);
  await assert.rejects(new FixedPackReader(failure).preview(sample), /WORKER_FAILED/);
  await assert.rejects(new FixedPackReader(hanging, 100).preview(sample), /TIMEOUT/);
  const reader = new FixedPackReader(hanging); const controller = new AbortController();
  const active = reader.preview(sample, controller.signal);
  await assert.rejects(reader.preview(sample), /QUEUE_FULL/);
  controller.abort(); await assert.rejects(active, /CANCELLED/);
});
