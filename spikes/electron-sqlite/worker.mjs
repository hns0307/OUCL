import { parentPort, workerData, threadId } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

if (!path.basename(workerData.root).startsWith('oucl-phase0-')) throw new Error('NOT_EXPERIMENT_FIXTURE');
const db = new DatabaseSync(path.join(workerData.root, workerData.mode === 'load' ? 'load.sqlite' : 'recovery.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
if (workerData.mode === 'hold') {
  db.exec("CREATE TABLE task(id TEXT PRIMARY KEY); INSERT INTO task VALUES ('committed'); BEGIN IMMEDIATE; INSERT INTO task VALUES ('uncommitted');");
  parentPort.postMessage({ phase: 'transaction-open', threadId });
  setInterval(() => {}, 10000);
} else if (workerData.mode === 'inspect') {
  const result = { phase: 'done', threadId, rows: db.prepare('SELECT id FROM task ORDER BY id').all().map(row => row.id), integrity: db.prepare('PRAGMA integrity_check').get().integrity_check };
  db.close(); parentPort.postMessage(result);
} else if (workerData.mode === 'load') {
  db.exec('CREATE TABLE work(id INTEGER PRIMARY KEY, state TEXT NOT NULL)');
  const statement = db.prepare('INSERT INTO work VALUES (?, ?)');
  parentPort.postMessage({ phase: 'started', threadId });
  const startedAt = Date.now();
  for (let batch = 0; batch < 10; batch++) {
    db.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < 20000; index++) statement.run(batch * 20000 + index, 'fixture-task');
    db.exec('COMMIT');
  }
  const result = { phase: 'done', threadId, rows: db.prepare('SELECT COUNT(*) AS count FROM work').get().count,
    elapsedMs: Date.now() - startedAt, integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version };
  db.close(); parentPort.postMessage(result);
} else { db.close(); throw new Error('UNKNOWN_EXPERIMENT_MODE'); }
