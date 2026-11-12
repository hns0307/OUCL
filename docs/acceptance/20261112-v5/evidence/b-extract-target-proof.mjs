import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? 'window-targets.jsonl';
if (!/^window-[a-z0-9-]+\.jsonl$/.test(name)) throw new Error('INVALID_LOG_NAME');
const a = '40000000-0000-4000-8000-000000000002', b = '40000000-0000-4000-8000-000000000003';
const active = task => task?.kind === 'mod-check' && ['queued','running','verifying','committing','pausing','cancelling','failing'].includes(task.state);
const witnesses = [], failures = [];
const lines = (await readFile(path.join(base, name), 'utf8')).split(/\r?\n/);
for (const [index, line] of lines.entries()) {
  if (!line.trim()) continue;
  const row = JSON.parse(line), v = row.value;
  if (row.kind === 'harness-error') failures.push({ line: index + 1, code: row.code });
  if (row.kind !== 'target-proof' || v?.verdict !== 'BRACKETED_WITNESS') continue;
  const valid = v.beforeSelected === b && v.afterSelected === b && v.reportInstance === b && v.nodeAbsent
    && v.aTargets?.ok && !v.aTargets.data.nextCursor && v.aTargets.data.items.every(item => item.instanceId === a)
    && v.aTargets.data.items.some(item => item.task.taskId === v.taskId && active(item.task))
    && v.bTargets?.ok && !v.bTargets.data.nextCursor && v.bTargets.data.items.every(item => item.instanceId === b && item.task.taskId !== v.taskId)
    && v.activeBefore?.ok && v.activeAfter?.ok && active(v.activeBefore.data.snapshot) && active(v.activeAfter.data.snapshot)
    && v.activeBefore.data.snapshot.taskId === v.taskId && v.activeAfter.data.snapshot.taskId === v.taskId
    && v.activeAfter.data.snapshot.revision >= v.activeBefore.data.snapshot.revision;
  if (!valid) throw new Error(`INVALID_CLAIMED_WITNESS_LINE_${index + 1}`);
  witnesses.push({ line: index + 1, time: row.time, taskId: v.taskId, startedAt: v.startedAt, finishedAt: v.finishedAt,
    beforeState: v.activeBefore.data.snapshot.state, afterState: v.activeAfter.data.snapshot.state,
    aTargetRequestId: v.aTargets.requestId, bTargetRequestId: v.bTargets.requestId,
    bTaskIds: v.bTargets.data.items.map(item => item.task.taskId) });
}
const result = { status: witnesses.length ? 'BRACKETED_WITNESS_FOUND' : 'NOT_COVERED', source: name, witnesses, failures,
  limitation: 'Sequential public IPC bracketing with stable selection, not an atomic transaction or actual upstream network evidence.' };
await writeFile(path.join(base, `proof-${name.replace(/\.jsonl$/, '.json')}`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!witnesses.length) process.exitCode = 2;
