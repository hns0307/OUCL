import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TaskTable } from '../src/services/storage/tasks.js';

const owner = '11111111-1111-4111-8111-111111111111';
const request = '22222222-2222-4222-8222-222222222222';
const orphan = '33333333-3333-4333-8333-333333333333';
const digest = 'a'.repeat(64);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, owner_id TEXT, kind TEXT, execution TEXT); CREATE TABLE requests (owner_id TEXT, request_id TEXT, kind TEXT, payload_digest TEXT, task_id TEXT)');
  return { db, table: new TaskTable(db) };
}
test('target inventory checks both sides and isolates unrequested kinds', () => {
  const { db, table } = fixture();
  try {
    const task = table.accept(owner, request, 'mod-check', digest);
    assert.deepEqual(table.modTargetAdmissions(owner, ['mod-check']), [{ requestId: request, payloadDigest: digest, task }]);
    db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)').run(orphan, owner, 'mod-install', JSON.stringify(task.execution));
    assert.equal(table.modTargetAdmissions(owner, ['mod-check']).length, 1);
    assert.throws(() => table.modTargetAdmissions(owner, ['mod-install']), { code: 'NEEDS_RECOVERY' });
    db.prepare('DELETE FROM tasks WHERE id=?').run(orphan);
    db.prepare('DELETE FROM tasks WHERE id=?').run(task.taskId);
    assert.throws(() => table.modTargetAdmissions(owner, ['mod-check']), { code: 'NEEDS_RECOVERY' });
  } finally { db.close(); }
});

test('target inventory rejects duplicate task references and unsupported filters', () => {
  const { db, table } = fixture();
  try {
    const task = table.accept(owner, request, 'mod-check', digest);
    db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)').run(orphan, owner, 'mod-check', JSON.stringify(task.execution));
    db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)').run(owner, orphan, 'mod-check', digest, task.taskId);
    assert.throws(() => table.modTargetAdmissions(owner, ['mod-check']), { code: 'NEEDS_RECOVERY' });
    assert.throws(() => table.modTargetAdmissions(owner, ['mod-check', 'mod-check']), { code: 'INVALID_RECORD' });
  } finally { db.close(); }
});

test('target inventory rejects request UUIDs duplicated with different case', () => {
  const { db, table } = fixture();
  try {
    const mixed = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const task = table.accept(owner, mixed, 'mod-check', digest);
    db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)').run(orphan, owner, 'mod-check', JSON.stringify(task.execution));
    db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)').run(owner, mixed.toUpperCase(), 'mod-check', digest, orphan);
    assert.throws(() => table.modTargetAdmissions(owner, ['mod-check']), { code: 'NEEDS_RECOVERY' });
  } finally { db.close(); }
});

test('target inventory accepts 1000 rows and refuses 1001 without truncation', () => {
  const { db, table } = fixture();
  try {
    const first = table.accept(owner, request, 'mod-check', digest);
    const putTask = db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)');
    const putRequest = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)');
    const id = (n: number): string => `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;
    for (let n = 1; n <= 1000; n++) {
      putTask.run(id(n), owner, 'mod-check', JSON.stringify(first.execution));
      putRequest.run(owner, id(n + 2000), 'mod-check', digest, id(n));
      if (n === 999) assert.equal(table.modTargetAdmissions(owner, ['mod-check']).length, 1000);
    }
    assert.throws(() => table.modTargetAdmissions(owner, ['mod-check']), { code: 'NEEDS_RECOVERY' });
  } finally { db.close(); }
});
