import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { prepareMrpackImport } from '../src/services/packs/mrpack-import.js';
import { modZip } from './fixtures/mod-zip.js';

const MOD = modZip([['fabric.mod.json', '{"schemaVersion":1,"id":"oucl_pack_test","version":"1.0.0","name":"Fixture"}']]);
const digest = (algorithm: string, data: Buffer) => createHash(algorithm).update(data).digest('hex');
const HASHES = { sha1: digest('sha1', MOD), sha512: digest('sha512', MOD) };
const SHA256 = digest('sha256', MOD);
const FILE_URL = 'https://cdn.modrinth.com/data/fixture1/versions/fixture2/fixture.jar';

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir());
  const dataDirectory = await mkdtemp(path.join(parent, 'oucl-mrpack-'));
  t.after(async () => { assert.equal(path.dirname(dataDirectory), parent); await rm(dataDirectory, { recursive: true, force: true }); });
  const game = path.join(dataDirectory, 'roots', randomUUID(), '.minecraft', 'versions', randomUUID());
  await mkdir(game, { recursive: true });
  const object = path.join(dataDirectory, 'store', 'objects', 'sha256', SHA256.slice(0, 2), SHA256);
  await mkdir(path.dirname(object), { recursive: true });
  await writeFile(object, MOD);
  const transport: typeof fetch = async (input, request) => {
    assert.equal(String(input), 'https://api.modrinth.com/v2/version_files');
    assert.equal(request?.method, 'POST');
    assert.deepEqual(JSON.parse(String(request?.body)), { hashes: [HASHES.sha512], algorithm: 'sha512' });
    return Response.json({
      [HASHES.sha512]: {
        project_id: 'fixture1', id: 'fixture2', name: 'Fixture', version_number: '1.0.0', version_type: 'release',
        date_published: '2026-01-01T00:00:00Z', loaders: ['fabric'], game_versions: ['1.20.1'], dependencies: [],
        environment: 'client_and_server', files: [{ filename: 'fixture.jar', url: FILE_URL, size: MOD.length, primary: true, hashes: HASHES }],
      },
    });
  };
  let downloads = 0;
  const options: Parameters<typeof prepareMrpackImport>[1] = {
    dataDirectory, transport, transferResource: async spec => {
      assert.equal(spec.url, FILE_URL);
      assert.equal(spec.expected.digest, HASHES.sha1);
      assert.equal(spec.expected.size, MOD.length);
      assert.equal(spec.anchor.kind, 'modrinth-version');
      downloads++;
      return { digest: SHA256, size: MOD.length, sourceKey: 'f'.repeat(64) };
    },
  };
  async function pack(entries: Array<[string, string]>, manifestSha1 = HASHES.sha1) {
    const bytes = modZip([['modrinth.index.json', JSON.stringify({
      formatVersion: 1, game: 'minecraft', name: 'Pack Fixture', versionId: '1.0.0',
      dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.14' },
      files: [{ path: 'mods/fixture.jar', fileSize: MOD.length, hashes: { ...HASHES, sha1: manifestSha1 },
        downloads: ['https://unused.example.net/ignored.jar'] },
      { path: 'mods/server-only.jar', env: { client: 'unsupported', server: 'required' } }],
    })], ...entries]);
    const file = path.join(dataDirectory, randomUUID() + '.mrpack');
    await writeFile(file, bytes);
    return prepareMrpackImport({ file, proof: { size: bytes.length, sha256: digest('sha256', bytes) } }, options);
  }
  return { game, pack, downloads: () => downloads };
}

test('a verified .mrpack stages official content and applies the client override layer in an isolated instance', async t => {
  const setup = await fixture(t);
  const pack = await setup.pack([['overrides/config/example.properties', 'mode=default\n'],
    ['client-overrides/config/example.properties', 'mode=client\n'], ['server-overrides/config/example.properties', 'mode=server\n']]);
  assert.equal(pack.mcVersionId, '1.20.1');
  assert.deepEqual(pack.loader, { kind: 'fabric', version: '0.16.14' });
  assert.equal(setup.downloads(), 0);
  const signal = new AbortController().signal;
  await pack.stage(signal);
  assert.equal(setup.downloads(), 1);
  assert.deepEqual(await readdir(setup.game), []);
  await pack.publish(setup.game, signal);
  assert.deepEqual(await readFile(path.join(setup.game, 'mods', 'fixture.jar')), MOD);
  assert.equal(await readFile(path.join(setup.game, 'config', 'example.properties'), 'utf8'), 'mode=client\n');
  assert.deepEqual((await readdir(setup.game)).sort(), ['config', 'mods']);
});

test('misrepresented hashes and executable overrides are rejected before touching instance files', async t => {
  const setup = await fixture(t);
  const mismatch = await setup.pack([], 'a'.repeat(40));
  await assert.rejects(mismatch.stage(new AbortController().signal), { code: 'UNTRUSTED_METADATA' });
  await assert.rejects(setup.pack([['overrides/mods/untrusted.jar', 'payload']]), { code: 'UNSUPPORTED_IMPORT' });
  assert.equal(setup.downloads(), 0);
  assert.deepEqual(await readdir(setup.game), []);
});

test('a publish collision leaves existing player files untouched and rolls back only its own additions', async t => {
  const setup = await fixture(t);
  const pack = await setup.pack([['overrides/options.txt', 'existingSetting:new\n']]);
  const existing = path.join(setup.game, 'options.txt');
  await writeFile(existing, 'existingSetting:old\n');
  await assert.rejects(pack.publish(setup.game, new AbortController().signal), { code: 'EEXIST' });
  assert.equal(await readFile(existing, 'utf8'), 'existingSetting:old\n');
  assert.deepEqual(await readdir(path.join(setup.game, 'mods')), []);
  assert.equal((await readdir(setup.game)).some(name => name.startsWith('.oucl-pack-')), false);
});
