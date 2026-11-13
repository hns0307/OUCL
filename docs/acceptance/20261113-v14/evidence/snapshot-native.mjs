// Read-only metadata/tasks/data observation. No database creation, recovery,
// business operation, GUI, or process action; sole write is a new snapshot JSON.
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2]; assert.match(label ?? '', /^[a-z][a-z0-9-]{0,48}$/);
const base = path.join(here, 'native-case'); const metadata = path.join(base, 'profile/metadata');
const hash = value => createHash('sha256').update(value).digest('hex');
async function info(file) { try { return await lstat(file); } catch (e) { if (e.code !== 'ENOENT') throw e; return undefined; } }
async function files(root, prefix = '') {
  const out = [];
  for (const item of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink(), 'UNEXPECTED_LINK'); const relative = prefix ? prefix + '/' + item.name : item.name;
    if (item.isDirectory()) out.push(...await files(root, relative));
    else out.push({ path: relative, sha256: hash(await readFile(path.join(root, relative))) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
const metadataInfo = await info(metadata); const games = path.join(base, 'OUCL.games'); const gameInfo = await info(games);
if (metadataInfo) assert.ok(metadataInfo.isDirectory() && !metadataInfo.isSymbolicLink());
if (gameInfo) assert.ok(gameInfo.isDirectory() && !gameInfo.isSymbolicLink());
const json = metadataInfo ? (await files(metadata)).filter(f => f.path.endsWith('.json')) : [];
const databaseFile = path.join(metadata, 'tasks.sqlite'); const databaseInfo = await info(databaseFile); let tables = null;
if (databaseInfo) {
  assert.ok(databaseInfo.isFile() && !databaseInfo.isSymbolicLink());
  const database = new DatabaseSync(databaseFile, { readOnly: true }); tables = {};
  try {
    database.exec('BEGIN');
    for (const [table, order] of [['tasks', 'id'], ['requests', 'owner_id,request_id'], ['operations', 'id']]) {
      const rows = database.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
      tables[table] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
    }
    database.exec('COMMIT');
  } finally { database.close(); }
}
const result = { label, time: new Date().toISOString(), metadataExists: Boolean(metadataInfo), json, databaseExists: Boolean(databaseInfo), tables,
  gameDirectoryExists: Boolean(gameInfo), gameFiles: gameInfo ? await files(games) : [], ownerPresent: Boolean(await info(path.join(metadata, 'owner.lock'))),
  scope: 'Related metadata JSON/table rows/game file contents; not all Chromium cache bytes or a continuous no-write proof.' };
await writeFile(path.join(here, `native-snapshot-${label}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ label, json: json.length, tables, gameDirectoryExists: result.gameDirectoryExists, ownerPresent: result.ownerPresent }));
