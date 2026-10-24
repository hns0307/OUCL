const { app } = require('electron');
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.argv[2];
assert.ok(root && path.basename(root).startsWith('oucl-phase0-'));
app.setPath('userData', path.join(root, 'profile'));
const workers = new Set();
const timeout = setTimeout(() => { console.error('ELECTRON_SQLITE_EXPERIMENT_TIMEOUT'); app.exit(1); }, 30000);

function start(mode) {
  const worker = new Worker(path.join(__dirname, 'worker.mjs'), { workerData: { root, mode } });
  workers.add(worker);
  const ended = once(worker, 'exit');
  const message = once(worker, 'message');
  return { worker, ended, message };
}

void app.whenReady().then(async () => {
  try {
    const owner = start('hold');
    const [open] = await owner.message;
    assert.equal(open.phase, 'transaction-open'); assert.ok(open.threadId > 0);
    await owner.worker.terminate(); await owner.ended;
    const inspector = start('inspect');
    const [recovered] = await inspector.message; await inspector.ended;
    assert.deepEqual(recovered.rows, ['committed']); assert.equal(recovered.integrity, 'ok');

    let active = false; let heartbeats = 0;
    const timer = setInterval(() => { if (active) heartbeats++; }, 5);
    const load = start('load');
    load.worker.on('message', value => { if (value.phase === 'started') active = true; });
    const [begun] = await load.message; assert.equal(begun.phase, 'started');
    const [completed] = await once(load.worker, 'message'); active = false;
    clearInterval(timer); await load.ended;
    assert.equal(completed.phase, 'done'); assert.equal(completed.rows, 200000);
    assert.equal(completed.integrity, 'ok'); assert.ok(heartbeats > 0, 'MAIN_EVENT_LOOP_DID_NOT_TICK');
    const report = { status: 'PASS', electron: process.versions.electron, node: process.versions.node,
      sqlite: completed.sqliteVersion, abruptWorkerTermination: true, committedRowPreserved: true,
      pendingRowRolledBack: true, integrity: recovered.integrity, workloadRows: completed.rows,
      workloadMs: completed.elapsedMs, mainEventLoopHeartbeats: heartbeats, workerThreadId: completed.threadId };
    console.log('OUCL_SQLITE_RESULT:' + JSON.stringify(report));
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    for (const worker of workers) await worker.terminate();
    console.error('ELECTRON_SQLITE_EXPERIMENT_FAILED:' + error.name);
    clearTimeout(timeout); app.exit(1);
  }
}).catch(() => { clearTimeout(timeout); app.exit(1); });
