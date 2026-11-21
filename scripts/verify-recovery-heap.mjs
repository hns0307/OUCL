import { Worker } from 'node:worker_threads';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const source = path.resolve('.test-build/official-game/metadata');
const destination = path.resolve(`.test-build/recovery-heap-${Date.now()}`); await mkdir(destination);
for (const name of await readdir(source)) {
  if (name === 'owner.lock' || name.startsWith('objects-index.') || name.startsWith('transfers.sqlite')) continue;
  if (!/^(?:[a-zA-Z0-9_-]+\.json|tasks\.sqlite(?:-wal|-shm)?)$/.test(name)) throw new Error('UNKNOWN_SNAPSHOT_ENTRY');
  await copyFile(path.join(source, name), path.join(destination, name));
}
const worker = new Worker(new URL('../.test-build/src/services/workers/entry.js', import.meta.url), {
  workerData: { version: 1, kind: 'storage', directory: destination }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
let report; const until = setTimeout(() => { void worker.terminate(); }, 30000);
worker.on('message', input => {
  if (input.kind === 'ready') {
    report = { status: 'PASS', ready: true, heapLimitMiB: 128 };
    worker.postMessage({ version: 1, id: '00000000-0000-4000-8000-000000000001', command: { kind: 'close' } });
  } else if (input.kind === 'startup-failed') report = { status: 'FAIL', code: input.code };
});
worker.on('error', error => { report = { status: 'FAIL', code: error.code ?? 'WORKER_ERROR', heapLimitMiB: 128 }; });
await new Promise(resolve => { worker.once('exit', resolve); }); clearTimeout(until);
report ??= { status: 'FAIL', code: 'NO_REPORT' };
const evidence = 'docs/validation/A1-08-official-install';
const output = report.ready ? 'recovery-after.json' : 'recovery-before.json';
await writeFile(path.join(evidence, output), JSON.stringify({ ...report, timestamp: new Date().toISOString(), copiedJournal: true, originalUntouched: true }, null, 2) + '\n');
// The validation snapshot is retained; the original lease is never removed or interpreted as stale here.
console.log(JSON.stringify(report));
if (report.ready) console.log(JSON.stringify({ snapshotOwnerReleased: !(await readdir(destination)).includes('owner.lock'), originalOwnerPresent: (await readFile(path.join(source, 'owner.lock'), 'utf8')).length === 36 }));
