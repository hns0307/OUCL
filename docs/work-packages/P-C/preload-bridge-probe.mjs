import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = path.resolve('docs/work-packages/P-C/evidence/v2a-integrated'); await mkdir(directory, { recursive: true });
await build({ entryPoints: ['src/ipc/preload-maintenance-preview.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24',
  outfile: path.join(directory, 'bridge-probe.mjs'), plugins: [{ name: 'in-memory-ipc', setup(buildContext) {
    buildContext.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    buildContext.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const ipcRenderer = globalThis.__pcFixtureIpc;', loader: 'js' }));
  } }] });
await build({ entryPoints: ['docs/work-packages/P-C/preview-ui-entry.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24',
  outfile: path.join(directory, 'bridge-main-probe.mjs') });
const { MaintenancePreviewJobs, handleMaintenancePreview } = await import(pathToFileURL(path.join(directory, 'bridge-main-probe.mjs')).href);
const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003'; const input = { rootId, instanceId, expectedRevision: 1,
  expectedFingerprint: 'a'.repeat(64), fileId: 'b'.repeat(64), action: 'disable' };
let calls = 0; const local = { state: 'satisfied', issues: [], providers: [] }; const platform = { state: 'satisfied', issues: [], files: [] };
const jobs = new MaintenancePreviewJobs({ preview: async () => { calls++; return { rootId, instanceId, instanceRevision: 1, fingerprint: input.expectedFingerprint,
  filename: 'example.jar', sha256: 'c'.repeat(64), platformFailures: [], impact: { action: 'disable', fileId: input.fileId, state: 'ready',
    before: { local, platform }, after: { local, platform }, introducedIssues: [], resolvedIssues: [], affectedProviders: [],
    directRequiredBy: [], transitiveRequiredBy: [], relations: [], truncated: false } }; } });
let delayed = true; let corrupt = false; let invocations = 0;
globalThis.__pcFixtureIpc = { invoke: async (channel, envelope) => {
  invocations++; const reply = await handleMaintenancePreview(channel, envelope, true, rootId, jobs);
  if (delayed && channel === 'mods:maintenancePreview') { delayed = false; await new Promise(resolve => setTimeout(resolve, 3100)); }
  if (corrupt && reply.ok) return { ...reply, data: { ...reply.data, previewId: rootId } };
  return reply;
} };
const { createMaintenancePreviewBridge } = await import(pathToFileURL(path.join(directory, 'bridge-probe.mjs')).href);
const bridge = createMaintenancePreviewBridge();
try {
  const invalid = await bridge.maintenancePreview('not-a-uuid', input); assert.equal(invalid.ok, false); assert.equal(invocations, 0);
  const first = await bridge.maintenancePreview(requestId, input); assert.equal(first.ok, false); assert.equal(first.error.code, 'TIMEOUT');
  const retry = await bridge.maintenancePreview(requestId, input); assert.equal(retry.ok, true); assert.equal(calls, 1);
  const status = await bridge.maintenancePreviewStatus(retry.data.previewId); assert.equal(status.ok, true); assert.equal(status.data.status, 'completed');
  assert.equal(status.data.result.fileId, input.fileId);
  corrupt = true; const mismatch = await bridge.maintenancePreviewStatus(retry.data.previewId); assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'UNAVAILABLE');
  const report = { status: 'PASS', preload: 'actual bundled source', ipc: 'in-memory replacement', handler: 'actual', registry: 'actual',
    lostAcceptanceReply: true, sameRequestSingleScan: true, mismatchedResponseRejected: true, rendererOrElectron: false };
  await writeFile(path.join(directory, 'preload-probe.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await jobs.close(); delete globalThis.__pcFixtureIpc; }
