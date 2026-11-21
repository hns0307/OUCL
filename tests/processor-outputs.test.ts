import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishProcessorOutputs, verifyProcessorOutputs } from '../src/services/loaders/processor-outputs.js';
import type { PersistedProcessorEvidence } from '../src/services/storage/instance-records.js';

test('derived outputs publish once, verify on reuse and preserve foreign conflicting files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-processor-output-'));
  const workspace = path.join(root, 'work'); const libraries = path.join(root, 'published');
  try {
    await mkdir(path.join(workspace, 'libraries/out'), { recursive: true }); await mkdir(libraries);
    const body = Buffer.from('computed fixture'); await writeFile(path.join(workspace, 'libraries/out/patched.jar'), body);
    const evidence: PersistedProcessorEvidence[] = [{ role: 'apply-client-patches', tool: 'fixture:tool:1', mainClass: 'fixture.Main', outputs: [{
      path: 'out/patched.jar', size: body.length, sha1: createHash('sha1').update(body).digest('hex'), sha256: createHash('sha256').update(body).digest('hex') }] }];
    const hashes = { hash: async (file: string) => { const bytes = await readFile(file); return { size: bytes.length,
      sha1: createHash('sha1').update(bytes).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') }; } };
    const signal = new AbortController().signal;
    await publishProcessorOutputs(workspace, libraries, evidence, hashes, signal);
    await publishProcessorOutputs(workspace, libraries, evidence, hashes, signal);
    await verifyProcessorOutputs(libraries, evidence, hashes, signal);
    const conflict: PersistedProcessorEvidence[] = [{ ...evidence[0]!, outputs: [{ ...evidence[0]!.outputs[0]!, path: 'out/foreign.jar' }] }];
    await writeFile(path.join(workspace, 'libraries/out/foreign.jar'), body); await writeFile(path.join(libraries, 'out/foreign.jar'), 'keep foreign bytes');
    await assert.rejects(publishProcessorOutputs(workspace, libraries, conflict, hashes, signal), { code: 'NEEDS_RECOVERY' });
    assert.equal(await readFile(path.join(libraries, 'out/foreign.jar'), 'utf8'), 'keep foreign bytes');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(verifyProcessorOutputs(libraries, evidence, hashes, controller.signal), { code: 'CANCELLED' });
  } finally { assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});
