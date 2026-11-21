import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createExecution } from '../src/core/task/machine.js';
import { TaskTable } from '../src/services/storage/tasks.js';

test('real SQLite target inventory retains both complete 1000-row domains and rejects either overflow', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, owner_id TEXT, kind TEXT, execution TEXT); CREATE TABLE requests (owner_id TEXT, request_id TEXT, kind TEXT, payload_digest TEXT, task_id TEXT)');
  const table = new TaskTable(db); const owner = randomUUID(); const digest = 'a'.repeat(64);
  const kinds = ['mod-check', 'mod-install'] as const;
  const insertTask = db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)');
  const insertRequest = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)');
  const execution = JSON.stringify(createExecution());
  function add(kind: typeof kinds[number]): string {
    const taskId = randomUUID(); insertTask.run(taskId, owner, kind, execution);
    insertRequest.run(owner, randomUUID(), kind, digest, taskId); return taskId;
  }
  try {
    for (const kind of kinds) for (let i = 0; i < 1000; i++) add(kind);
    const before = db.prepare('SELECT COUNT(*) AS count FROM tasks').get();
    const rows = table.modTargetAdmissions(owner, kinds);
    assert.equal(rows.length, 2000); assert.equal(new Set(rows.map(row => row.task.taskId)).size, 2000);
    for (const kind of kinds) assert.equal(rows.filter(row => row.task.kind === kind).length, 1000);
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS count FROM tasks').get(), before);
    for (const kind of kinds) {
      const extra = add(kind);
      assert.throws(() => table.modTargetAdmissions(owner, kinds), { code: 'NEEDS_RECOVERY' });
      assert.equal(table.modTargetAdmissions(owner, [kind === 'mod-check' ? 'mod-install' : 'mod-check']).length, 1000);
      db.prepare('DELETE FROM requests WHERE task_id=?').run(extra); db.prepare('DELETE FROM tasks WHERE id=?').run(extra);
    }
    assert.equal(table.modTargetAdmissions(owner, kinds).length, 2000);
  } finally { db.close(); }
});
