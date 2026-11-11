const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { readdirSync } = require('node:fs');
const directory = path.join(__dirname, 'evidence/20261111/e3-profile/metadata');
const db = new DatabaseSync(path.join(directory, 'tasks.sqlite'), { readOnly: true });
try {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const counts = {};
  for (const row of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name)) throw new Error('UNEXPECTED_TABLE');
    counts[row.name] = db.prepare(`SELECT COUNT(*) AS count FROM "${row.name}"`).get().count;
  }
  console.log(JSON.stringify({ tables: counts, records: readdirSync(directory).filter(name => name.endsWith('.json')).sort() }, null, 2));
} finally { db.close(); }
