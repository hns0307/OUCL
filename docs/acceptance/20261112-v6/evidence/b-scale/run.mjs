import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const base = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(base, '../..');
const names = {
  StorageClient: 'services/workers/storage-client', TargetAdapter: 'ipc/task-targets',
  ModTaskService: 'services/mods/tasks', ModInstallTaskService: 'services/mods/install-tasks',
  modPlanDigest: 'services/mods/plan-identity', modPlanInputDigest: 'services/mods/plan-identity',
  isTargetResult: 'shared/contracts/task-targets', isTaskSnapshot: 'shared/contracts/instances',
  instanceFailure: 'shared/contracts/instances', parseReply: 'services/workers/protocol',
};
await build({ absWorkingDir: repository, stdin: { resolveDir: repository,
  contents: Object.entries(names).map(([name, file]) => `export {${name}} from './src/${file}.ts';`).join('\n')
    + "\nexport {modReadyInstance} from './tests/fixtures/mod-ready-instance.ts';" },
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(base, 'modules.cjs') });
const s = createRequire(import.meta.url)(path.join(base, 'modules.cjs'));
const metadata = path.join(base, 'metadata'), games = path.join(base, 'games');
// mkdir without recursive deliberately refuses overwriting any prior evidence database.
await mkdir(metadata); await mkdir(games);
const rootId = '60000000-0000-4000-8000-000000000001', instanceId = '60000000-0000-4000-8000-000000000002';
const worker = path.join(repository, 'acceptance-results/product/workers/entry.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let storage = await s.StorageClient.open(worker, metadata, 120000);
const admissions = [], plans = [], evidence = { synthetic: true, source: 'unchanged v3 production worker; real StorageClient/SQLite/JSON APIs', reads: [], pages: [] };
const save = () => writeFile(path.join(base, 'result.json'), JSON.stringify(evidence, null, 2));
function makePlan(requestId) {
  const input = { instanceId, expectedRevision: 1, root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: 'a'.repeat(40) }, selections: {} };
  const body = { formatVersion: 1, instanceId, instanceRevision: 1, fingerprint: 'b'.repeat(64), minecraft: '1.20.1', loader: 'fabric',
    rootVersionId: 'RootVer1', state: 'ready', attempts: 1, totalDownloadBytes: 0,
    items: [{ projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', fileId: 'a'.repeat(40), sha512: 'c'.repeat(128),
      size: 1, disposition: 'library', requiredBy: [] }], issues: [] };
  return { formatVersion: 1, rootId, requestId, payloadDigest: s.modPlanInputDigest(input), input,
    plan: { ...body, planId: s.modPlanDigest(body) }, status: 'preview' };
}
async function read(label, kinds = ['mod-check', 'mod-install']) {
  const start = performance.now();
  try {
    const result = await storage.readModTargets({ rootId, rootRevision: 1, instanceId, kinds });
    evidence.reads.push({ label, kinds, ok: true, count: result.items.length, bytes: Buffer.byteLength(JSON.stringify(result)), ms: performance.now() - start });
    return result;
  } catch (error) { evidence.reads.push({ label, kinds, ok: false, code: error.code, ms: performance.now() - start }); return undefined; }
  finally { await save(); }
}
try {
  await storage.createInstallation({ rootId, dataDirectory: games });
  await storage.writeInstance(instanceId, 0, s.modReadyInstance(rootId, instanceId));
  const checks = [];
  for (let index = 0; index < 1000; index++) {
    const requestId = randomUUID(), payloadDigest = hash({ instanceId, expectedRevision: 1, mode: 'check' });
    const task = await storage.accept(rootId, requestId, 'mod-check', payloadDigest);
    checks.push({ taskId: task.taskId, requestId, payloadDigest, instanceId, instanceRevision: 1,
      mode: 'check', stage: 'queued', reportRevision: 0, errorCode: null });
    admissions.push({ requestId, taskId: task.taskId, kind: task.kind });
  }
  await storage.writeModJobs(0, { formatVersion: 1, rootId, items: checks });
  console.log('1000 real mod-check admissions + valid index persisted');
  for (let index = 0; index < 1000; index++) {
    const requestId = randomUUID(), plan = makePlan(requestId);
    await storage.writeModPlan(requestId, 0, plan);
    const task = await storage.acceptModConfirmation(requestId, plan.plan.planId, true);
    plans.push(requestId); admissions.push({ requestId, taskId: task.taskId, kind: task.kind });
    if ((index + 1) % 100 === 0) console.log(`${index + 1} real plan JSON + mod-confirm admissions persisted`);
  }
  await writeFile(path.join(base, 'admissions.json'), JSON.stringify({ rootId, instanceId, admissions, plans }, null, 2));
  evidence.admissionCounts = { checks: checks.length, installs: plans.length };
  const first = await read('before-reopen');
  if (first) assert.equal(first.items.length, 2000);
  await storage.close(); storage = await s.StorageClient.open(worker, metadata, 120000);
  const second = await read('after-reopen'); if (second) assert.equal(second.items.length, 2000);
  // Actual production projection services, used read-only; executors are never started for synthetic queued admissions.
  const modChecks = new s.ModTaskService(storage, undefined, undefined), installs = new s.ModInstallTaskService(storage, undefined, undefined);
  const adapter = new s.TargetAdapter(storage, modChecks, installs);
  try {
    let cursor; const ids = new Set(); const kindCounts = { 'mod-check': 0, 'mod-install': 0 };
    for (let page = 0; page < 21; page++) {
      const request = { contractVersion: 1, requestId: randomUUID(), payload: { instanceId, kinds: ['mod-check','mod-install'], limit: 100, ...(cursor ? { cursor } : {}) } };
      const start = performance.now(), result = await adapter.handle(request, true, 1, randomUUID());
      evidence.pages.push({ page: page + 1, ok: result.ok, code: result.ok ? undefined : result.error.code,
        count: result.ok ? result.data.items.length : 0, ms: performance.now() - start }); await save();
      if (!result.ok) break;
      assert.ok(s.isTargetResult(result, request));
      for (const row of result.data.items) { assert.ok(!ids.has(row.task.taskId)); ids.add(row.task.taskId); kindCounts[row.task.kind]++; }
      cursor = result.data.nextCursor; if (!cursor) break;
    }
    evidence.pagination = { complete: ids.size === 2000 && !cursor, count: ids.size, kindCounts };
  } finally { adapter.close(); }
  const overflow = makePlan(randomUUID()); await storage.writeModPlan(overflow.requestId, 0, overflow);
  await assert.rejects(storage.acceptModConfirmation(overflow.requestId, overflow.plan.planId, true), { code: 'QUEUE_FULL' });
  evidence.confirmation1001 = 'QUEUE_FULL; formal API rejected before admission';
  await read('after-rejected-install-1001');
  await storage.accept(rootId, randomUUID(), 'mod-check', hash({ instanceId, expectedRevision: 1, mode: 'check' }));
  const over = await read('after-check-1001'); assert.equal(over, undefined); assert.equal(evidence.reads.at(-1).code, 'NEEDS_RECOVERY');
  evidence.check1001 = 'Real generic admission API adds 1001st check; inventory refuses before index proof, no 1001-entry index fabricated';
  evidence.status = first && second && evidence.pagination.complete ? 'PASS' : 'PARTIAL_SCALE_TIMEOUT_OR_REJECTION';
} catch (error) { evidence.status = 'FAIL'; evidence.error = { code: error.code ?? error.name, message: error.message }; process.exitCode = 1; }
finally { await storage.close(); await save(); }
console.log(JSON.stringify(evidence, null, 2));
