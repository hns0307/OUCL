import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createWindowsDistributionFiles, loadWindowsDistributionFiles, WindowsDistributionMutations } from '../src/services/distribution/native-files.js';
import type { DistributionNativeExecutable } from '../src/services/distribution/native-files.js';
import type { DistributionMutationContext } from '../src/services/distribution/transaction-files.js';
import type { FileProof } from '../src/services/distribution/transaction-record.js';
import { SimulatedDistributionCrash, parseDistributionJournal, transactionDigest } from '../src/services/distribution/transaction-record.js';
import type { DistributionJournal, DistributionPlan, DistributionReceipt, TransactionEnvelope } from '../src/services/distribution/transaction-record.js';
import { DistributionTransactionService } from '../src/services/distribution/transaction.js';
import type { DistributionTransactionPorts } from '../src/services/distribution/transaction.js';

const windows = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
const root = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/native-adapter-review-r2', 'native-files');
const sourceRoot = process.env.OUCL_SOURCE_ROOT ?? process.cwd();
const execute = promisify(execFile);
let built: Promise<DistributionNativeExecutable> | undefined;
function helper(): Promise<DistributionNativeExecutable> {
  built ??= (async () => {
    const output = path.join(root, 'build'); await mkdir(output, { recursive: true });
    await execute(process.execPath, [path.join(sourceRoot, 'scripts/build-distribution-files.mjs')], {
      cwd: sourceRoot, env: { ...process.env, OUCL_BUILD_ROOT: output }, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    });
    const executable = path.join(output, 'native', 'distribution-files.exe');
    return { executable, sha256: createHash('sha256').update(await readFile(executable)).digest('hex') };
  })(); return built;
}
async function proof(file: string): Promise<FileProof> {
  const stat = await lstat(file, { bigint: true });
  return { dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
}
async function fixture() {
  const binary = await helper(); const base = await mkdtemp(path.join(root, 'case-')); const game = path.join(base, 'game');
  const txId = randomUUID(); const leaseToken = randomUUID(); const stage = path.join(game, '.oucl-distribution-staging', txId);
  await mkdir(stage, { recursive: true }); await mkdir(path.join(game, 'mods'));
  const lock = path.join(game, 'oucl.session.lock'); await writeFile(lock, leaseToken);
  const info = await lstat(game, { bigint: true });
  const context: DistributionMutationContext = { root: game, txId, rootIdentity: { dev: String(info.dev), ino: String(info.ino) }, leaseToken };
  const source = path.join(stage, '0.new'); await writeFile(source, 'native-adapter-synthetic-fixture');
  return { binary, base, game, stage, source, lock, context, expected: await proof(source), adapter: new WindowsDistributionMutations(binary) };
}
async function absent(file: string): Promise<void> { await assert.rejects(readFile(file), { code: 'ENOENT' }); }

test('Node wrapper executes real C# identity-bound link, delete, rename and lease release', windows, async () => {
  const f = await fixture(); const target = path.join(f.game, 'mods', 'published.jar'); const retained = path.join(f.stage, '0.old');
  await f.adapter.mutate('link', f.context, f.source, f.expected, target);
  assert.equal((await lstat(target, { bigint: true })).ino.toString(), f.expected.ino); assert.equal((await lstat(target)).nlink, 2);
  await f.adapter.mutate('delete', f.context, f.source, f.expected); await absent(f.source);
  assert.equal((await lstat(target)).nlink, 1);
  await f.adapter.mutate('rename', f.context, target, f.expected, retained); await absent(target);
  assert.equal(await readFile(retained, 'utf8'), 'native-adapter-synthetic-fixture');
  await f.adapter.mutate('delete', f.context, retained, f.expected); await absent(retained);
  await f.adapter.mutate('release', f.context, f.lock, await proof(f.lock)); await absent(f.lock);
});

test('existing destination is preserved for both native no-replace rename and hardlink', windows, async () => {
  for (const operation of ['rename', 'link'] as const) {
    const f = await fixture(); const target = path.join(f.game, 'mods', 'existing.jar'); await writeFile(target, 'player-content');
    await assert.rejects(f.adapter.mutate(operation, f.context, f.source, f.expected, target), { code: 'FILES_CHANGED' });
    assert.equal(await readFile(target, 'utf8'), 'player-content'); assert.equal(await readFile(f.source, 'utf8'), 'native-adapter-synthetic-fixture');
  }
});

test('wrong file inode, volume, hash and size cannot mutate the real source', windows, async () => {
  const f = await fixture(); const target = path.join(f.game, 'mods', 'not-published.jar');
  for (const expected of [{ ...f.expected, ino: String(BigInt(f.expected.ino) + 1n) }, { ...f.expected, dev: String(BigInt(f.expected.dev) + 1n) },
    { ...f.expected, sha256: '0'.repeat(64) }, { ...f.expected, size: f.expected.size + 1 }]) {
    await assert.rejects(f.adapter.mutate('rename', f.context, f.source, expected, target), { code: 'FILES_CHANGED' });
    await absent(target); assert.equal(await readFile(f.source, 'utf8'), 'native-adapter-synthetic-fixture');
  }
});

test('wrong root identity or lease token fail before native publication and preserve the lease', windows, async () => {
  const f = await fixture(); const target = path.join(f.game, 'mods', 'not-published.jar');
  await assert.rejects(f.adapter.mutate('link', { ...f.context, rootIdentity: { ...f.context.rootIdentity, ino: String(BigInt(f.context.rootIdentity.ino) + 1n) } }, f.source, f.expected, target), { code: 'FILES_CHANGED' });
  await assert.rejects(f.adapter.mutate('link', { ...f.context, leaseToken: randomUUID() }, f.source, f.expected, target), { code: 'NEEDS_RECOVERY' });
  await absent(target); assert.equal(await readFile(f.lock, 'utf8'), f.context.leaseToken);
});

test('renamed original root and replacement same-path namespace do not satisfy persisted directory identity', windows, async () => {
  const f = await fixture(); const retained = path.join(f.base, 'original-game'); await rename(f.game, retained);
  await mkdir(f.stage, { recursive: true }); await mkdir(path.join(f.game, 'mods')); await writeFile(f.source, 'replacement-content'); await writeFile(f.lock, f.context.leaseToken);
  const target = path.join(f.game, 'mods', 'not-published.jar');
  await assert.rejects(f.adapter.mutate('rename', f.context, f.source, f.expected, target), { code: 'FILES_CHANGED' });
  await absent(target); assert.equal(await readFile(f.source, 'utf8'), 'replacement-content');
  assert.equal(await readFile(path.join(retained, '.oucl-distribution-staging', f.context.txId, '0.new'), 'utf8'), 'native-adapter-synthetic-fixture');
});

test('binary digest mismatch rejects a valid operation before launching the helper', windows, async () => {
  const f = await fixture(); const target = path.join(f.game, 'mods', 'not-published.jar');
  const wrong = new WindowsDistributionMutations({ ...f.binary, sha256: '0'.repeat(64) });
  await assert.rejects(wrong.mutate('link', f.context, f.source, f.expected, target), { code: 'NEEDS_RECOVERY' });
  await absent(target); assert.equal(await readFile(f.source, 'utf8'), 'native-adapter-synthetic-fixture');
});

test('wrapper rejects path escape, protected regions, wrong transaction staging, ADS and unknown DTO fields', windows, async () => {
  const f = await fixture();
  for (const source of [path.join(f.base, 'outside'), path.join(f.game, 'saves', 'world'), path.join(f.game, '.oucl-distribution-staging', randomUUID(), '0.new'),
    path.join(f.game, 'mods', 'unsafe.jar:stream'), path.join(f.game, 'mods', 'CON')]) {
    await assert.rejects(f.adapter.mutate('delete', f.context, source, f.expected), { code: 'FILES_CHANGED' });
  }
  const extraContext = { ...f.context, unexpected: true }; const extraExpected = { ...f.expected, unexpected: true };
  await assert.rejects(f.adapter.mutate('delete', extraContext, f.source, f.expected), { code: 'FILES_CHANGED' });
  await assert.rejects(f.adapter.mutate('delete', f.context, f.source, extraExpected), { code: 'FILES_CHANGED' });
  await assert.rejects(f.adapter.mutate('release', f.context, f.source, f.expected), { code: 'FILES_CHANGED' });
  await assert.rejects(f.adapter.mutate('delete', f.context, f.source, f.expected, path.join(f.game, 'mods', 'invalid-destination')), { code: 'FILES_CHANGED' });
  assert.equal(await readFile(f.source, 'utf8'), 'native-adapter-synthetic-fixture');
});

test('transaction file factory really uses the native helper for publication, rollback moves and lease release', windows, async () => {
  const binary = await helper(); const base = await mkdtemp(path.join(root, 'factory-')); const game = path.join(base, 'game'); await mkdir(game);
  const artifact = path.join(base, 'artifact'); await writeFile(artifact, 'factory-synthetic');
  const files = createWindowsDistributionFiles(binary)(game, randomUUID()); await files.initialize(); const token = randomUUID(); await files.claim(token, false);
  const original = await proof(artifact); const fresh = await files.copy(artifact, 0, original.sha256, original.size);
  await files.directory(path.join(game, 'mods')); const target = path.join(game, 'mods', 'managed.jar');
  await files.publish(files.stage(0), target, fresh);
  await files.moveAside(target, files.retired(0), fresh); await absent(target);
  await files.removeOwned(files.retired(0), fresh); await files.removeOwned(files.stage(0), fresh);
  await files.release(token); await absent(files.lock);
  const replaced = path.join(base, 'retained-root'); await rename(game, replaced); await mkdir(game);
  const recovery = createWindowsDistributionFiles(binary)(game, randomUUID(), files.gameIdentity);
  await assert.rejects(recovery.bindRoot(), { code: 'FILES_CHANGED' });
});

for (const interruption of ['published', 'receipt-committed'] as const) test(`real transaction ${interruption} crash recovery uses the native factory and persisted root identity`, windows, async () => {
  const binary = await helper(); const base = await mkdtemp(path.join(root, 'recovery-')); const gameDir = path.join(base, 'game'); await mkdir(gameDir);
  const artifact = path.join(base, 'artifact'); await writeFile(artifact, 'synthetic-recovery'); const bytes = await proof(artifact);
  const rootId = randomUUID(); const instanceId = randomUUID(); const txId = randomUUID();
  const manifest = { formatVersion: 1 as const, packageId: 'fixture-pack', packageVersion: '1',
    target: { minecraft: '1.20.1', javaMajor: 17 as const, loader: 'vanilla' as const, loaderVersion: null },
    operations: [{ kind: 'add' as const, area: 'mods' as const, path: 'fixture.jar', artifactId: 'fixture-artifact', sha256: bytes.sha256, size: bytes.size }] };
  const plan: DistributionPlan = { formatVersion: 1, txId, rootId, instanceId, instanceRevision: 1, sourceId: 'fixture-source',
    packageId: manifest.packageId, packageVersion: manifest.packageVersion, sequence: 1, manifestSha256: transactionDigest(manifest), manifest };
  let journal: TransactionEnvelope<DistributionJournal> | undefined; let receipt: TransactionEnvelope<DistributionReceipt> | undefined; let predecessorGone = false;
  const nativeFactory = createWindowsDistributionFiles(binary); let factoryCalls = 0;
  // Journal/CAS and dead-predecessor evidence are explicit injected fixtures. Native file IO and helper processes are real.
  const ports: DistributionTransactionPorts = {
    journals: { read: async id => { assert.equal(id, txId); return structuredClone(journal); }, write: async (id, expected, value) => {
      assert.equal(id, txId); assert.equal(expected, journal?.revision ?? 0);
      journal = { revision: expected + 1, data: parseDistributionJournal(value) }; return structuredClone(journal);
    } },
    receipts: { read: async id => { assert.equal(id, instanceId); return structuredClone(receipt); }, commit: async (id, expected, value) => {
      assert.equal(id, instanceId); assert.equal(expected, receipt?.revision ?? 0); receipt = { revision: expected + 1, data: structuredClone(value) }; return structuredClone(receipt);
    } },
    authorize: async input => { assert.equal(transactionDigest(input), transactionDigest(plan)); },
    readTarget: async () => ({ rootId, instanceId, revision: 1, gameDir }), isIdle: async () => true, artifact: async () => artifact,
    canRecover: async () => predecessorGone, createFiles: (game, id, expectedRoot) => {
      factoryCalls++; if (factoryCalls === 2) { assert.ok(journal); assert.deepEqual(expectedRoot, journal.data.gameIdentity); }
      return nativeFactory(game, id, expectedRoot);
    },
    checkpoint: async point => { if (point === interruption) throw new SimulatedDistributionCrash(); },
  };
  await assert.rejects(new DistributionTransactionService(ports).commit(plan), SimulatedDistributionCrash);
  assert.equal(await readFile(path.join(gameDir, 'mods', 'fixture.jar'), 'utf8'), 'synthetic-recovery');
  assert.equal(receipt !== undefined, interruption === 'receipt-committed'); assert.ok(journal); assert.equal(journal.data.formatVersion, 2);
  assert.equal(journal.data.gameIdentity.ino, (await lstat(gameDir, { bigint: true })).ino.toString());
  predecessorGone = true;
  const recovered = await new DistributionTransactionService(ports).recover(txId); assert.equal(recovered.phase, interruption === 'published' ? 'rolledBack' : 'committed');
  assert.equal(factoryCalls, 2); await absent(path.join(gameDir, 'oucl.session.lock'));
  if (interruption === 'published') {
    await absent(path.join(gameDir, 'mods', 'fixture.jar'));
    assert.equal(await readFile(path.join(gameDir, '.oucl-distribution-staging', txId, '0.rollback'), 'utf8'), 'synthetic-recovery'); assert.equal(receipt, undefined);
  } else {
    assert.equal(await readFile(path.join(gameDir, 'mods', 'fixture.jar'), 'utf8'), 'synthetic-recovery');
    await absent(path.join(gameDir, '.oucl-distribution-staging', txId, '0.new')); assert.equal((await lstat(path.join(gameDir, 'mods', 'fixture.jar'))).nlink, 1);
    assert.equal(receipt?.data.txId, txId);
  }
});

test('packaged metadata loader returns a working real native factory from freshly built protected payload entries', windows, async () => {
  const binary = await helper(); const factory = await loadWindowsDistributionFiles(path.dirname(binary.executable));
  const base = await mkdtemp(path.join(root, 'loaded-')); const game = path.join(base, 'game'); await mkdir(game);
  const artifact = path.join(base, 'artifact'); await writeFile(artifact, 'loader-synthetic'); const bytes = await proof(artifact);
  const files = factory(game, randomUUID()); await files.initialize(); const token = randomUUID(); await files.claim(token, false);
  const staged = await files.copy(artifact, 0, bytes.sha256, bytes.size); await files.directory(path.join(game, 'mods'));
  const target = path.join(game, 'mods', 'loaded.jar'); await files.publish(files.stage(0), target, staged);
  await files.removeOwned(files.stage(0), staged); await files.release(token);
  assert.equal(await readFile(target, 'utf8'), 'loader-synthetic'); assert.equal((await lstat(target)).nlink, 1); await absent(files.lock);
});

test('packaged metadata loader rejects schema/path/hash/size tampering and changed executable bytes without granting a factory', windows, async () => {
  const binary = await helper(); const bytes = await readFile(binary.executable);
  const valid = { formatVersion: 1, file: 'distribution-files.exe', sha256: binary.sha256, bytes: bytes.length };
  const variants: unknown[] = [{ ...valid, formatVersion: 2 }, { ...valid, extra: true }, { ...valid, file: '../distribution-files.exe' },
    { ...valid, sha256: '0'.repeat(64) }, { ...valid, bytes: bytes.length + 1 }, { ...valid, bytes: 0 }];
  for (const metadata of variants) {
    const directory = await mkdtemp(path.join(root, 'invalid-metadata-'));
    await copyFile(binary.executable, path.join(directory, 'distribution-files.exe'));
    await writeFile(path.join(directory, 'distribution-files.json'), JSON.stringify(metadata));
    await assert.rejects(loadWindowsDistributionFiles(directory), { code: 'NEEDS_RECOVERY' });
  }
  const malformed = await mkdtemp(path.join(root, 'malformed-metadata-'));
  await copyFile(binary.executable, path.join(malformed, 'distribution-files.exe')); await writeFile(path.join(malformed, 'distribution-files.json'), '{malformed');
  await assert.rejects(loadWindowsDistributionFiles(malformed), { code: 'NEEDS_RECOVERY' });
  const changed = await mkdtemp(path.join(root, 'changed-binary-')); await writeFile(path.join(changed, 'distribution-files.json'), JSON.stringify(valid));
  const tampered = Buffer.from(bytes); tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
  await writeFile(path.join(changed, 'distribution-files.exe'), tampered);
  await assert.rejects(loadWindowsDistributionFiles(changed), { code: 'NEEDS_RECOVERY' });
});
