import test from 'node:test';
import assert from 'node:assert/strict';
import { JAVA_INDEX, isJavaMetadataUrl, parseJavaPackage, JavaRuntimeService } from '../src/services/java/runtime.js';
import { JavaProbe } from '../src/services/java/probe.js';
import type { RegisteredJava } from '../src/services/storage/launch-profiles.js';
const digest = 'a'.repeat(40);
const java: RegisteredJava = { javaId: '00000000-0000-4000-8000-000000000001', executable: 'D:\\java\\bin\\java.exe', major: 17, version: '17.0.15', vendor: 'fixture' };
const manifestUrl = `https://piston-meta.mojang.com/v1/packages/${digest}/manifest.json`;
const file = { type: 'file', downloads: { raw: { url: `https://piston-data.mojang.com/v1/objects/${digest}/java.exe`, sha1: digest, size: 4 } } };
const pack = { files: { bin: { type: 'directory' }, 'bin/java.exe': file } };
test('Java metadata accepts only fixed official index and content-addressed manifests', () => {
  assert.ok(isJavaMetadataUrl(JAVA_INDEX)); assert.ok(isJavaMetadataUrl(manifestUrl));
  for (const bad of [manifestUrl + '?x=1', manifestUrl.replace('https:', 'http:'), manifestUrl.replace('piston-meta.mojang.com', 'example.com'), JAVA_INDEX.replace('all.json', 'other.json')]) assert.equal(isJavaMetadataUrl(bad), false);
});
test('Java package refuses traversal, links, aliases, collisions, missing executable and untrusted downloads', () => {
  assert.equal(parseJavaPackage(pack, digest).files[0]?.spec.anchor.kind, 'mojang-runtime');
  for (const files of [{ '../bin/java.exe': file }, { 'bin/java.exe': file, 'BIN/JAVA.EXE': file }, { 'bin/java.exe': { type: 'link', target: 'elsewhere' } },
    { bin: file, 'bin/java.exe': file }, { 'bin/other.exe': file }, { 'bin/java.exe': { ...file, downloads: { raw: { ...file.downloads.raw, url: 'https://cdn.modrinth.com/file' } } } }]) assert.throws(() => parseJavaPackage({ files }, digest));
});
test('compatible measured registered Java is reused without contacting the network', async () => {
  const probe = new JavaProbe({ inspect: async () => {} });
  probe.probe = async () => ({ ...java, architecture: 'x64', os: 'windows' });
  const service = new JavaRuntimeService({ list: async () => ({ javas: [java], selectedJavaId: java.javaId, accounts: [], requests: [] }), registerJava: async () => java },
    { prepareJava: async () => { throw new Error('UNEXPECTED_INSTALL'); } }, { read: async () => { throw new Error('UNEXPECTED_NETWORK'); } }, probe, {});
  assert.equal(await service.ensure(17, java.javaId, new AbortController().signal), java);
});
test('missing Java follows pinned official manifest, prepares files then measures before registration', async () => {
  const calls: string[] = []; const probe = new JavaProbe(); probe.probe = async () => ({ ...java, architecture: 'x64', os: 'windows' });
  const service = new JavaRuntimeService({ list: async () => ({ javas: [], accounts: [], requests: [] }), registerJava: async () => { calls.push('register'); return java; } },
    { prepareJava: async value => { assert.equal(value.digest, digest); calls.push('prepare'); return java.executable; } },
    { read: async (url, sha1) => { calls.push(url); if (url === manifestUrl) assert.equal(sha1, digest);
      return { body: JSON.stringify(url === JAVA_INDEX ? { 'windows-x64': { 'java-runtime-gamma': [{ manifest: { url: manifestUrl, sha1: digest } }] } } : pack), sha1: digest, sha256: 'b'.repeat(64) }; } }, probe, {});
  assert.equal(await service.ensure(17, java.javaId, new AbortController().signal), java);
  assert.deepEqual(calls, [JAVA_INDEX, manifestUrl, 'prepare', 'register']);
});
test('cancelled or unsupported Java never downloads or registers', async () => {
  const service = new JavaRuntimeService({ list: async () => { throw new Error('UNEXPECTED'); }, registerJava: async () => java }, { prepareJava: async () => java.executable });
  await assert.rejects(service.ensure(25, java.javaId, new AbortController().signal), { code: 'JAVA_INCOMPATIBLE' });
  await assert.rejects(service.ensure(17, java.javaId, AbortSignal.abort()), { code: 'CANCELLED' });
});

test('inspection and runtime share selected-candidate priority and measurement budget; registration cannot substitute a patch', async () => {
  const { InstalledJavaFacts } = await import('../src/services/mods/java-facts.js');
  const selected = { ...java, version: '17.0.1' }; const fallback = { ...java, javaId: '00000000-0000-4000-8000-000000000002', executable: 'D:\\fallback\\java.exe' };
  const saved = { javas: [fallback, selected], selectedJavaId: selected.javaId, accounts: [], requests: [] };
  const calls: Array<{ file: string; timeout: number | undefined }> = [];
  const probe = new JavaProbe();
  probe.probe = async (file, options) => { calls.push({ file, timeout: options?.timeoutMs }); return { ...selected, architecture: 'x64', os: 'windows' }; };
  const facts = new InstalledJavaFacts({ list: async () => saved }, probe);
  const service = new JavaRuntimeService({ list: async () => saved, registerJava: async () => selected },
    { prepareJava: async () => { throw new Error('UNEXPECTED'); } }, { read: async () => { throw new Error('UNEXPECTED_NETWORK'); } }, probe, {});
  assert.equal(await facts.read(17), selected.version);
  assert.equal((await service.ensure(17, java.javaId, new AbortController().signal)).version, selected.version);
  assert.deepEqual(calls, [{ file: selected.executable, timeout: 8000 }, { file: selected.executable, timeout: 8000 }]);
  const changed = new JavaRuntimeService({ list: async () => saved, registerJava: async () => fallback },
    { prepareJava: async () => { throw new Error('UNEXPECTED'); } }, { read: async () => { throw new Error('UNEXPECTED_NETWORK'); } }, probe, {});
  await assert.rejects(changed.ensure(17, java.javaId, new AbortController().signal), { code: 'JAVA_INCOMPATIBLE' });
});
