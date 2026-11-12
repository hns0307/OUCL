import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url));
const labels = process.argv.slice(2); if (!labels.length) labels.push('cold', 'hot');
if (labels.some(label => !/^[a-z0-9-]{1,32}$/.test(label))) throw new Error('INVALID_LABEL');
const seed = JSON.parse(await readFile(path.join(base, 'seed.json'), 'utf8'));
const expected = seed.instances.flatMap(item => [item.installTaskId, item.modTaskId]).sort();
const results = [];
for (const label of labels) {
  const lines = (await readFile(path.join(base, `window-${label}.jsonl`), 'utf8')).split(/\r?\n/);
  const rows = lines.flatMap((line, index) => line.trim() ? [{ line: index + 1, ...JSON.parse(line) }] : []);
  const publicWitness = [], domWitness = [], errors = [];
  for (const row of rows) {
    if (row.kind === 'harness-error') errors.push({ line: row.line, code: row.code });
    const v = row.value;
    if (row.kind !== 'public-and-dom' || !v?.tasks?.ok || !v.nodeAbsent || v.tasks.data.nextCursor) continue;
    const items = v.tasks.data.items;
    if (!expected.every(id => items.some(item => item.taskId === id && item.state === 'completed'))
      || items.filter(item => item.kind === 'install').length < 2 || items.filter(item => item.kind === 'mod-check').length < 2) continue;
    publicWitness.push({ line: row.line, time: row.time, taskIds: items.map(item => item.taskId) });
    if (expected.every(id => v.taskCards?.some(card => card.taskId === id && card.state === 'completed' && card.observation === 'confirmed')))
      domWitness.push({ line: row.line, time: row.time, cards: v.taskCards });
  }
  results.push({ label, publicWitness: publicWitness[0] ?? null, domWitness: domWitness[0] ?? null, errors,
    normalExit: rows.some(row => row.kind === 'will-quit') && rows.some(row => row.kind === 'exit' && row.code === 0) });
}
const pass = results.every(row => row.publicWitness && row.domWitness && row.normalExit);
const result = { status: pass ? 'PASS' : 'INCOMPLETE', expected, results,
  scope: 'Production shell, real installer/mod tasks, synthetic non-executable local inputs; no game/upstream acceptance.' };
await writeFile(path.join(base, 'window-extraction.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); if (!pass) process.exitCode = 2;
