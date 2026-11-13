import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { InstalledJavaFacts } from '../src/services/mods/java-facts.js';
import { JavaProbeError } from '../src/services/java/probe.js';
import type { LaunchProfiles, RegisteredJava } from '../src/services/storage/launch-profiles.js';
import { modInventoryContext } from '../src/services/mods/context.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';
import { restoreInstallMetadata } from '../src/services/install/installer.js';

const registered = (major: 17 | 21, name: string): RegisteredJava => ({ javaId: randomUUID(), major, version: `${major}.0.1`, vendor: 'fixture', executable: `D:\\fixture\\${name}\\java.exe` });
const measured = (java: RegisteredJava, version = '17.0.13+7') => ({ ...java, version, architecture: 'x64' as const, os: 'windows' as const });
const profiles = (javas: RegisteredJava[], selectedJavaId?: string): LaunchProfiles => ({ javas, accounts: [], requests: [], ...(selectedJavaId ? { selectedJavaId } : {}) });

test('Java facts measure selected compatible registered JVM and never trust persisted version text', async () => {
  const other = registered(17, 'other'); const selected = registered(17, 'selected'); const incompatible = registered(21, 'other-major');
  const calls: string[] = []; const saved = profiles([incompatible, other, selected], selected.javaId);
  const reader = new InstalledJavaFacts({ list: async () => structuredClone(saved) }, { probe: async file => {
    calls.push(file); return measured(selected);
  } });
  assert.equal(await reader.read(17), '17.0.13+7'); assert.deepEqual(calls, [selected.executable]);
  assert.equal(saved.javas[2]!.version, '17.0.1');
});

test('missing, failed or changed-major JVM leaves unknown and does not discover a runtime', async () => {
  const a = registered(17, 'missing'); const b = registered(17, 'changed'); const saved = profiles([a, b]); let calls = 0;
  const reader = new InstalledJavaFacts({ list: async () => saved }, { probe: async file => {
    calls++; if (file === a.executable) throw new JavaProbeError('INVALID_JAVA'); return measured(registered(21, 'changed'), '21.0.5');
  } });
  assert.equal(await reader.read(17), null); assert.equal(calls, 2);
  assert.equal(await reader.read(8), null); assert.equal(calls, 2);
});

test('Java facts cancel by joining probe close, reject overlapping work and detect profile changes', async () => {
  const java = registered(17, 'selected'); let saved = profiles([java]); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const controller = new AbortController(); let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const reader = new InstalledJavaFacts({ list: async () => structuredClone(saved) }, { probe: async () => { entered(); await gate; return measured(java); } });
  const pending = reader.read(17, controller.signal); await started;
  await assert.rejects(reader.read(17), { code: 'SCAN_BUSY' }); controller.abort(); release();
  await assert.rejects(pending, { code: 'CANCELLED' });
  const changed = new InstalledJavaFacts({ list: async () => structuredClone(saved) }, { probe: async () => { saved = profiles([]); return measured(java); } });
  await assert.rejects(changed.read(17), { code: 'FILES_CHANGED' });
  assert.equal(await changed.read(17), null);
});

test('Mod context requests the real metadata Java major and propagates measured facts without inference', async () => {
  const rootId = randomUUID(); const instanceId = randomUUID(); const record = modReadyInstance(rootId, instanceId); const majors: number[] = [];
  record.receipts!.push({ area: 'assets', path: 'indexes/5.json',
    artifactId: `sha1-${createHash('sha1').update(record.metadata!.assetIndexBody).digest('hex')}`, mode: 'copy' });
  const storage = { readInstallation: async () => ({ schemaVersion: 1 as const, revision: 1, data: { rootId, dataDirectory: 'D:\\fixture' } }),
    readInstance: async () => ({ schemaVersion: 1 as const, revision: 1, data: record }) };
  const context = modInventoryContext(storage, undefined, { read: async major => { majors.push(major); return '17.0.13+7'; } });
  assert.equal((await context(instanceId)).environment.versions.java, '17.0.13+7'); assert.deepEqual(majors, [17]);
  assert.equal((await modInventoryContext(storage)(instanceId)).environment.versions.java, null);
});

test('metadata reconstruction preserves the original official index path and input record', () => {
  const record = modReadyInstance(randomUUID(), randomUUID());
  record.receipts!.push({ area: 'assets', path: 'indexes/5.json',
    artifactId: `sha1-${createHash('sha1').update(record.metadata!.assetIndexBody).digest('hex')}`, mode: 'copy' });
  const before = structuredClone(record);
  const restored = restoreInstallMetadata(record);
  assert.deepEqual(restored.plan.views.filter(view => view.area === 'assets' && view.path.startsWith('indexes/'))
    .map(view => view.path), ['indexes/5.json']);
  assert.deepEqual(record, before);
});

test('ready restoration accepts only one trusted legacy or alias index receipt and never rewrites evidence', () => {
  const record = modReadyInstance(randomUUID(), randomUUID());
  const digest = createHash('sha1').update(record.metadata!.assetIndexBody).digest('hex');
  const legacy = { area: 'assets' as const, path: 'indexes/5.json', artifactId: `sha1-${digest}`, mode: 'copy' as const };
  const alias = { ...legacy, path: `indexes/5-${digest}.json` };
  const before = structuredClone(record);
  for (const receipt of [legacy, alias]) {
    const value = { ...record, receipts: [...record.receipts!, receipt] };
    const snapshot = structuredClone(value);
    const plan = restoreInstallMetadata(value).plan;
    assert.deepEqual(plan.views.filter(view => view.area === 'assets' && view.path.startsWith('indexes/')).map(view => view.path), [receipt.path]);
    assert.deepEqual(value, snapshot);
  }
  for (const receipts of [record.receipts!, [...record.receipts!, legacy, alias], [...record.receipts!, legacy, legacy],
    [...record.receipts!, { ...legacy, artifactId: `sha1-${'f'.repeat(40)}` }],
    [...record.receipts!, { ...alias, path: `indexes/5-${'f'.repeat(40)}.json` }]]) {
    assert.throws(() => restoreInstallMetadata({ ...record, receipts }), { code: 'NEEDS_RECOVERY' });
  }
  assert.deepEqual(record, before);
});
