import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { InstalledJavaFacts } from '../src/services/mods/java-facts.js';
import { JavaProbeError } from '../src/services/java/probe.js';
import type { LaunchProfiles, RegisteredJava } from '../src/services/storage/launch-profiles.js';
import { modInventoryContext } from '../src/services/mods/context.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';

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
  const storage = { readInstallation: async () => ({ schemaVersion: 1 as const, revision: 1, data: { rootId, dataDirectory: 'D:\\fixture' } }),
    readInstance: async () => ({ schemaVersion: 1 as const, revision: 1, data: record }) };
  const context = modInventoryContext(storage, undefined, { read: async major => { majors.push(major); return '17.0.13+7'; } });
  assert.equal((await context(instanceId)).environment.versions.java, '17.0.13+7'); assert.deepEqual(majors, [17]);
  assert.equal((await modInventoryContext(storage)(instanceId)).environment.versions.java, null);
});
