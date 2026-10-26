import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { scanModArchive } from '../src/services/mods/archive.js';
import { inspectModArchiveBytes } from '../src/services/install/native-archive.js';
import { ModArchiveReader } from '../src/services/workers/mod-archive-reader.js';
import { parseModArchiveReply, parseModArchiveRequest } from '../src/services/workers/mod-archive-protocol.js';
import { modZip } from './fixtures/mod-zip.js';
import { parseModDeclarationFacts } from '../src/services/workers/mod-declarations-protocol.js';
import { parseJsonModDeclarations } from '../src/core/mods/json-declarations.js';
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const fake = new URL('./fixtures/mod-worker.js', import.meta.url);

async function file(bytes: Buffer): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-mod-archive-')); const target = path.join(root, 'test.jar');
  await writeFile(target, bytes); return target;
}
const hash = (value: Buffer, algorithm = 'sha256'): string => createHash(algorithm).update(value).digest('hex');

test('local JAR worker returns real hashes, exact four declarations and nested evidence without writes', async () => {
  const inner = modZip([['fabric.mod.json', '{"id":"embedded"}']]);
  const bytes = modZip([['fabric.mod.json', '{"id":"outer","jars":[{"file":"nested/a.jar"}]}'], ['quilt.mod.json', '{}'],
    ['META-INF/mods.toml', '[[mods]]\nmodId="outer"'], ['META-INF/neoforge.mods.toml', '[[mods]]\nmodId="outer"'],
    ['META-INF/jarjar/metadata.json', '{}'], ['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\n'], ['nested/a.jar', inner], ['thing.class', 'inert']]);
  const target = await file(bytes); const before = await readdir(path.dirname(target));
  const result = await new ModArchiveReader(entry).read(target);
  assert.equal(result.sha1, hash(bytes, 'sha1')); assert.equal(result.sha256, hash(bytes)); assert.equal(result.sha512, hash(bytes, 'sha512'));
  assert.equal(result.size, bytes.length); assert.equal(result.archives.length, 2);
  assert.equal(result.archives[0]!.documents.length, 6); assert.equal(result.archives[1]!.sha256, hash(inner));
  assert.deepEqual(result.archives[0]!.declarations.map(item => item.format), ['fabric', 'quilt', 'forge', 'neoforge']);
  assert.deepEqual(result.archives[1]!.entries, ['nested/a.jar']); assert.deepEqual(await readdir(path.dirname(target)), before);
  const reply = parseModArchiveReply({ version: 1, kind: 'mod-archive-result', result });
  assert.equal(reply.kind, 'mod-archive-result'); if (reply.kind === 'mod-archive-result') assert.deepEqual(reply.result, result);
});

test('declaration interpretation runs inside the worker and its private facts are independently validated', async () => {
  const target = await file(modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'actual_mod', version: '2', depends: { java: '>=17' } })],
    ['META-INF/mods.toml', 'modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="first_mod"\nversion="1"\n[[mods]]\nmodId="second_mod"\nversion="${file.jarVersion}"']]));
  const result = await new ModArchiveReader(entry).read(target);
  assert.equal(result.archives[0]!.declarations[0]!.mods[0]!.id, 'actual_mod');
  assert.equal(result.archives[0]!.declarations[1]!.mods.length, 2);
  assert.equal(result.archives[0]!.declarations[1]!.mods[1]!.version, null);
  const facts = parseJsonModDeclarations('fabric', JSON.stringify({ schemaVersion: 1, id: 'actual_mod', version: '2', depends: { java: '>=17' } }));
  assert.deepEqual(parseModDeclarationFacts(facts), facts);
  const mod = facts.mods[0]!; const dependency = mod.dependencies[0]!;
  for (const value of [{ ...facts, script: 'run' }, { ...facts, format: 'unknown' }, { ...facts, nested: ['../escape.jar'] },
    { ...facts, language: { id: 'loader', range: 7 } }, { ...facts, issues: ['path/private'] },
    { ...facts, mods: [{ ...mod, id: 'bad:id' }] }, { ...facts, mods: [{ ...mod, client: {} }] },
    { ...facts, mods: [{ ...mod, provides: [{ id: 'other_mod', version: '${version}' }] }] },
    { ...facts, mods: [{ ...mod, dependencies: [{ ...dependency, kind: {} }] }] },
    { ...facts, mods: [{ ...mod, dependencies: [{ ...dependency, range: { all: [] } }] }] }]) assert.throws(() => parseModDeclarationFacts(value));
  const node = result.archives[0]!;
  for (const declarations of [[], [facts, facts], [{ ...facts, format: 'quilt' }]]) {
    assert.throws(() => parseModArchiveReply({ version: 1, kind: 'mod-archive-result', result: { ...result, archives: [{ ...node, declarations }] } }));
  }
});

test('scanner refuses corrupt class CRCs, unsafe identities, malformed ZIPs and invalid UTF8', async () => {
  const damaged = modZip([['thing.class', 'payload']]); damaged.writeUInt32LE(123, 14);
  for (const bytes of [damaged, Buffer.from('not a jar'), modZip([['../escape', 'x']]),
    modZip([['fabric.mod.json', Buffer.from([0xff])]]), modZip([['same', '1'], ['Same', '2']])]) {
    await assert.rejects(scanModArchive(await file(bytes)), error => error instanceof Error && /^(INVALID|UNSAFE)_ARCHIVE$/.test(error.message));
  }
  const ordinary = await file(modZip([['plain.txt', 'no metadata']]));
  assert.deepEqual((await scanModArchive(ordinary)).archives[0]!.documents, []);
  await assert.rejects(scanModArchive(path.join(path.dirname(ordinary), 'missing.jar')), { code: 'ARCHIVE_IO' });
  const directory = path.join(path.dirname(ordinary), 'directory.jar'); await mkdir(directory);
  await assert.rejects(scanModArchive(directory), { code: 'UNSAFE_ARCHIVE' });
});

test('scanner enforces entry, nesting, node and shared decompression budgets', async () => {
  await assert.rejects(scanModArchive(await file(modZip([['fabric.mod.json', 'a'.repeat(1024 ** 2 + 1)]]))), { code: 'ARCHIVE_LIMIT' });
  let nested = modZip([['fabric.mod.json', '{}']]); for (let i = 0; i < 5; i++) nested = modZip([['nested.jar', nested]]);
  await assert.rejects(scanModArchive(await file(nested)), { code: 'ARCHIVE_LIMIT' });
  const leaf = modZip([['plain.txt', 'x']]);
  await assert.rejects(scanModArchive(await file(modZip(Array.from({ length: 64 }, (_, i) => [`${i}.jar`, leaf])))), { code: 'ARCHIVE_LIMIT' });
  assert.throws(() => inspectModArchiveBytes(modZip([['a', '123']]), [], 2), { code: 'ARCHIVE_LIMIT' });
  assert.throws(() => inspectModArchiveBytes(leaf, [], -1), { code: 'ARCHIVE_LIMIT' });
});

test('internal Mod worker protocol rejects executable selectors, forged trees and unbounded output', async () => {
  const target = path.resolve('test.jar'); const request = { version: 1, kind: 'mod-archive', file: target };
  assert.deepEqual(parseModArchiveRequest(request), request);
  for (const value of [{ ...request, script: 'run' }, { ...request, version: 2 }, { ...request, entries: ['a'] }, { ...request, file: 'relative' }]) {
    assert.throws(() => parseModArchiveRequest(value));
  }
  const result = await scanModArchive(await file(modZip([['fabric.mod.json', '{}']])));
  const good = { version: 1, kind: 'mod-archive-result', result };
  const root = result.archives[0]!;
  for (const value of [{ ...good, command: 'run' }, { ...good, result: { ...result, sha512: 'bad' } },
    { ...good, result: { ...result, archives: [{ ...root, sha256: 'a'.repeat(64) }] } },
    { ...good, result: { ...result, archives: [root, { ...root, entries: ['missing.jar', 'child.jar'] }] } },
    { ...good, result: { ...result, archives: [root, { ...root, entries: ['../bad.jar'] }] } },
    { ...good, result: { ...result, archives: [{ ...root, documents: [...root.documents, ...root.documents] }] } },
    { version: 1, kind: 'mod-archive-failed', code: 'PRIVATE_ERROR' }]) assert.throws(() => parseModArchiveReply(value));
});

test('Mod scan cancellation, timeout, concurrency and malformed workers join exit before reuse', async () => {
  const reader = new ModArchiveReader(fake, 100); const controller = new AbortController();
  const pending = reader.read(path.resolve('hang.jar'), controller.signal);
  await assert.rejects(reader.read(path.resolve('hang.jar')), { code: 'QUEUE_FULL' });
  controller.abort(); await assert.rejects(pending, { code: 'CANCELLED' });
  await assert.rejects(reader.read(path.resolve('hang.jar')), { code: 'SCAN_TIMEOUT' });
  await assert.rejects(reader.read(path.resolve('hang.jar'), controller.signal), { code: 'CANCELLED' });
  const patient = new ModArchiveReader(fake);
  for (const name of ['malformed.jar', 'crash.jar', 'empty.jar']) await assert.rejects(patient.read(path.resolve(name)), { code: 'WORKER_FAILED' });
  await assert.rejects(reader.read('relative'), { code: 'UNSAFE_ARCHIVE' });
  assert.throws(() => new ModArchiveReader(fake, 0), { code: 'WORKER_FAILED' });
});
