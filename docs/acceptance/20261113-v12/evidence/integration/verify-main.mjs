import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const frozen = 'D:/MC_start/OUCL-acceptance-v11-20261113';
const main = 'D:/MC_start/OUCL-download-main';
const manifest = JSON.parse(await readFile(path.join(frozen, 'FREEZE-MANIFEST.json'), 'utf8'));
const docs = new Set(['OUCL-Codex/docs/TASK_PLAN.md', 'OUCL-Codex/docs/DECISIONS.md']);
const hash = data => createHash('sha256').update(data).digest('hex');
const files = [];
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: main, encoding: 'utf8' }).trim().split('\n'));
const excluded = [];
for (const file of manifest.files) {
  if (docs.has(file.path)) { excluded.push({path:file.path,reason:'versioned-approval-document-append'}); continue; }
  if (!tracked.has(file.path)) {
    if (!file.path.startsWith('docs/work-packages/P-A/tools/')) throw new Error(`UNEXPECTED_UNTRACKED_FROZEN_PATH ${file.path}`);
    excluded.push({path:file.path,reason:'historical-tools-excluded-from-candidate'}); continue;
  }
  const a = await readFile(path.join(frozen, file.path));
  if (hash(a) !== file.sha256) throw new Error(`FROZEN_CHANGED ${file.path}`);
  const b = await readFile(path.join(main, file.path));
  let match = a.equals(b), mode = 'bytes';
  if (!match && /\.(?:ts|tsx|js|mjs|cjs|json|md|txt|yaml|yml|html|css|cs|props|targets|xml)$/.test(file.path)) {
    match = a.toString('utf8').replace(/\r\n/g, '\n') === b.toString('utf8').replace(/\r\n/g, '\n');
    mode = 'git-line-ending-normalization';
  }
  files.push({ path: file.path, match, mode });
}
const source = path.join(frozen, 'release/OUCL-0.3.0-acceptance-20261113-v11.exe');
const destination = path.join(main, 'release/OUCL-0.3.0-acceptance-20261113-v11.exe');
const expected = '3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6';
if (hash(await readFile(source)) !== expected) throw new Error('SOURCE_EXE_CHANGED');
try { await access(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; await copyFile(source, destination, 1); }
const exeHash = hash(await readFile(destination));
const archived = JSON.parse(await readFile(path.join(main, 'docs/acceptance/20261113-v12/evidence/MANIFEST.json'), 'utf8'));
for (const file of archived) {
  if (hash(await readFile(path.join(main, 'docs/acceptance/20261113-v12/evidence', file.path))) !== file.sha256) throw new Error(`ARCHIVE_CHANGED ${file.path}`);
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: main, encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain'], { cwd: main, encoding: 'utf8' });
const result = { status: files.every(f => f.match) && exeHash === expected && !status ? 'PASS' : 'FAIL', checkedAt: new Date().toISOString(), head,
  frozenTrackedFilesCompared: files.length, excluded, files, archiveChecks: archived.length, exeHash, destination, mainClean: !status };
await writeFile(path.join(frozen, 'acceptance-results/main-verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, files: undefined }));
if (result.status !== 'PASS') process.exitCode = 1;
