import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const base = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? 'before';
if (!/^[a-z0-9-]{1,32}$/.test(label)) throw new Error('INVALID_LABEL');
const seed = JSON.parse(await readFile(path.join(base, 'seed.json'), 'utf8'));
const hashes = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(target);
    else if (/\.jar(?:\.disabled)?$/i.test(entry.name)) hashes.push({ relative: path.relative(seed.games, target),
      bytes: (await readFile(target)).length, sha256: createHash('sha256').update(await readFile(target)).digest('hex') });
  }
}
await visit(seed.games);
const db = new DatabaseSync(path.join(seed.profile, 'metadata/tasks.sqlite'), { readOnly: true });
let tasks;
try { tasks = db.prepare('SELECT id, owner_id, kind, execution FROM tasks ORDER BY id').all(); }
finally { db.close(); }
await writeFile(path.join(base, `state-${label}.json`), JSON.stringify({ hashes, tasks }, null, 2));
console.log(JSON.stringify({ jars: hashes.length, tasks: tasks.length, label }));
