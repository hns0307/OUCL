import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, lstat, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import { DistributionTransactionService } from '../src/services/distribution/transaction.js';
import type { DistributionTransactionPorts, DistributionTransactionCheckpoint } from '../src/services/distribution/transaction.js';
import { SimulatedDistributionCrash, assertDistributionJournalTransition, parseDistributionJournal, parseDistributionPlan, parseDistributionReceipt, transactionDigest } from '../src/services/distribution/transaction-record.js';
import type { DistributionPlan, TransactionEnvelope } from '../src/services/distribution/transaction-record.js';
import type { DistributionManifest, DistributionOperation } from '../src/core/distribution/manifest.js';
import { parseDistributionManifest } from '../src/core/distribution/manifest.js';
import { DistributionTransactionFiles } from '../src/services/distribution/transaction-files.js';

async function fixture() {
  const parent = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp', 'distribution-transactions'); await mkdir(parent, { recursive: true });
  const base = await mkdtemp(path.join(parent, 'case-')); const game = path.join(base, 'game'); const metadata = path.join(base, 'private'); const artifacts = path.join(base, 'artifacts');
  for (const directory of [game, metadata, artifacts]) await mkdir(directory);
  const rootId = randomUUID(); const instanceId = randomUUID(); let revision = 1; let idle = true; let recovery = false; let receiptAckLost = false;
  const source = async (content: string): Promise<{ sha256: string; size: number }> => {
    const sha256 = (await import('node:crypto')).createHash('sha256').update(content).digest('hex'); await writeFile(path.join(artifacts, sha256), content); return { sha256, size: Buffer.byteLength(content) };
  };
  async function read<T>(key: string, parse: (value: unknown) => T): Promise<TransactionEnvelope<T> | undefined> {
    try { const value = JSON.parse(await readFile(path.join(metadata, key), 'utf8')) as { revision: number; data: unknown }; return { revision: value.revision, data: parse(value.data) }; }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
  }
  async function write<T>(key: string, expected: number, data: T, parse: (value: unknown) => T): Promise<TransactionEnvelope<T>> {
    const before = await read(key, parse); if ((before?.revision ?? 0) !== expected) throw new Error('REVISION_CONFLICT');
    const next = { revision: expected + 1, data: parse(data) }; const temporary = path.join(metadata, randomUUID() + '.tmp');
    await writeFile(temporary, JSON.stringify(next)); await rename(temporary, path.join(metadata, key)); return next;
  }
  const ports: DistributionTransactionPorts = {
    journals: { read: id => read(id + '.json', parseDistributionJournal), write: (id, expected, value) => write(id + '.json', expected, value, parseDistributionJournal) },
    receipts: { read: () => read('receipt.json', parseDistributionReceipt), commit: async (_id, expected, value) => {
      const saved = await write('receipt.json', expected, value, parseDistributionReceipt); if (receiptAckLost) { receiptAckLost = false; throw new Error('TIMEOUT'); } return saved;
    } },
    authorize: async plan => { if (plan.sourceId !== 'club') throw new Error('UNTRUSTED'); },
    readTarget: async () => ({ rootId, instanceId, revision, gameDir: game }), isIdle: async () => idle,
    artifact: async (plan, index) => { const operation = plan.manifest.operations[index]!; assert.ok(operation.kind === 'add' || operation.kind === 'replace'); return path.join(artifacts, operation.sha256); },
    canRecover: async () => recovery,
  };
  function plan(operations: DistributionOperation[], sequence = 1): DistributionPlan {
    const manifest: DistributionManifest = parseDistributionManifest({ formatVersion: 1, packageId: 'pack', packageVersion: String(sequence), target: { minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.0' }, operations });
    return parseDistributionPlan({ formatVersion: 1, txId: randomUUID(), rootId, instanceId, instanceRevision: revision, sourceId: 'club', packageId: manifest.packageId,
      packageVersion: manifest.packageVersion, sequence, manifestSha256: transactionDigest(manifest), manifest });
  }
  return { base, game, metadata, artifacts, ports, source, plan, service: () => new DistributionTransactionService(ports),
    recoverable: () => { recovery = true; }, busy: () => { idle = false; }, changeRevision: () => { revision++; }, loseReceiptAck: () => { receiptAckLost = true; },
    receipt: () => ports.receipts.read(instanceId), close: () => rm(base, { recursive: true, force: true }) };
}
const errorCode = (code: string) => ({ code });

test('distribution transaction add, replace, remove and keep use private ledger and unique receipt commit', async () => {
  const f = await fixture();
  try {
    const first = await f.source('first'); const second = await f.source('second');
    await mkdir(path.join(f.game, 'mods')); await writeFile(path.join(f.game, 'mods', 'personal.jar'), 'personal');
    const one = f.plan([{ kind: 'add', area: 'mods', path: 'managed.jar', artifactId: 'a', ...first }, { kind: 'keep', area: 'mods', path: 'personal.jar' }]);
    const service = f.service(); assert.equal((await service.commit(one)).phase, 'committed'); assert.equal((await service.commit(one)).phase, 'committed');
    assert.equal((await lstat(path.join(f.game, 'mods', 'managed.jar'))).nlink, 1);
    const claim = (await f.receipt())!.data.entries[0]!;
    const two = f.plan([{ kind: 'replace', area: 'mods', path: 'managed.jar', artifactId: 'b', managedId: claim.managedId, expectedSha256: first.sha256, ...second }], 2);
    assert.equal((await service.commit(two)).phase, 'committed'); assert.equal(await readFile(path.join(f.game, 'mods', 'managed.jar'), 'utf8'), 'second');
    const three = f.plan([{ kind: 'remove', area: 'mods', path: 'managed.jar', managedId: claim.managedId, expectedSha256: second.sha256 }], 3);
    assert.equal((await service.commit(three)).phase, 'committed'); assert.equal((await f.receipt())!.data.entries.length, 0);
    await assert.rejects(readFile(path.join(f.game, 'mods', 'managed.jar')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(f.game, 'mods', 'personal.jar'), 'utf8'), 'personal');
  } finally { await f.close(); }
});

test('distribution transaction rejects forged game receipts, owned config edits and rollback publisher sequence', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('config'); await mkdir(path.join(f.game, 'mods')); await writeFile(path.join(f.game, 'mods', 'local.jar'), 'config');
    const managedId = randomUUID(); await writeFile(path.join(f.game, '.oucl-distribution-receipts.json'), JSON.stringify({ managedId, sha256: bytes.sha256 }));
    await assert.rejects(f.service().commit(f.plan([{ kind: 'remove', area: 'mods', path: 'local.jar', managedId, expectedSha256: bytes.sha256 }])), errorCode('FILES_CHANGED'));
    assert.equal(await readFile(path.join(f.game, 'mods', 'local.jar'), 'utf8'), 'config');
    const added = f.plan([{ kind: 'add', area: 'config', path: 'settings.txt', artifactId: 'c', ...bytes }]); await f.service().commit(added);
    const claim = (await f.receipt())!.data.entries[0]!;
    await assert.rejects(f.service().commit(f.plan([{ kind: 'remove', area: 'config', path: 'settings.txt', managedId: claim.managedId, expectedSha256: bytes.sha256 }], 2)), errorCode('FILES_CHANGED'));
    await assert.rejects(f.service().commit(f.plan([], 1)), errorCode('UNTRUSTED_DISTRIBUTION'));
  } finally { await f.close(); }
});

test('distribution cancellation before receipt commit rolls back published files and retains private bytes', async () => {
  const f = await fixture(); const controller = new AbortController();
  try {
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async point => { if (point === 'published') controller.abort(); };
    await assert.rejects(f.service().commit(plan, controller.signal), errorCode('CANCELLED'));
    assert.equal((await f.ports.journals.read(plan.txId))!.data.phase, 'rolledBack'); assert.equal(await f.receipt(), undefined);
    await assert.rejects(readFile(path.join(f.game, 'mods', 'new.jar')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(f.game, '.oucl-distribution-staging', plan.txId, '0.rollback'), 'utf8'), 'new');
  } finally { await f.close(); }
});

test('receipt acknowledgement loss reconciles exact txID and cancellation after commit is too late', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'resourcepacks', path: 'pack.zip', artifactId: 'a', ...bytes }]);
    f.loseReceiptAck(); const service = f.service(); assert.equal((await service.commit(plan)).phase, 'committed');
    assert.equal((await f.receipt())!.data.txId, plan.txId); await assert.rejects(service.cancel(plan.txId), errorCode('CANCEL_TOO_LATE'));
  } finally { await f.close(); }
});

for (const point of ['backed-up', 'published', 'receipt-committed', 'journal-committed'] as const) test(`fresh distribution service recovers durable ${point} crash from exact journal proofs`, async () => {
  const f = await fixture();
  try {
    const old = await f.source('old'); const fresh = await f.source('fresh');
    await f.service().commit(f.plan([{ kind: 'add', area: 'mods', path: 'owned.jar', artifactId: 'a', ...old }]));
    const claim = (await f.receipt())!.data.entries[0]!;
    const plan = f.plan([{ kind: 'replace', area: 'mods', path: 'owned.jar', artifactId: 'b', managedId: claim.managedId, expectedSha256: old.sha256, ...fresh }], 2);
    f.ports.checkpoint = async actual => { if (actual === point) throw new SimulatedDistributionCrash(point); };
    await assert.rejects(f.service().commit(plan), SimulatedDistributionCrash);
    await assert.rejects(f.service().recover(plan.txId), errorCode('NEEDS_RECOVERY'));
    f.recoverable(); delete f.ports.checkpoint; const recovered = await f.service().recover(plan.txId);
    const committed = point === 'receipt-committed' || point === 'journal-committed';
    assert.equal(recovered.phase, committed ? 'committed' : 'rolledBack');
    assert.equal(await readFile(path.join(f.game, 'mods', 'owned.jar'), 'utf8'), committed ? 'fresh' : 'old');
    assert.equal((await f.service().recover(plan.txId)).phase, recovered.phase);
  } finally { await f.close(); }
});

test('cancellation arriving after receipt publication cannot roll back committed files', async () => {
  const f = await fixture(); const controller = new AbortController();
  try {
    const bytes = await f.source('committed'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    const service = f.service(); f.ports.checkpoint = async point => {
      if (point === 'receipt-committed') { controller.abort(); await assert.rejects(service.cancel(plan.txId), errorCode('CANCEL_TOO_LATE')); }
    };
    assert.equal((await service.commit(plan, controller.signal)).phase, 'committed');
    assert.equal(await readFile(path.join(f.game, 'mods', 'new.jar'), 'utf8'), 'committed');
  } finally { await f.close(); }
});

test('rolled-back journal crash recovery releases only the proven original lease', async () => {
  const f = await fixture(); const controller = new AbortController();
  try {
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async point => { if (point === 'published') controller.abort(); if (point === 'journal-rolled-back') throw new SimulatedDistributionCrash(); };
    await assert.rejects(f.service().commit(plan, controller.signal), SimulatedDistributionCrash);
    assert.equal((await f.ports.journals.read(plan.txId))!.data.phase, 'rolledBack');
    f.recoverable(); delete f.ports.checkpoint; assert.equal((await f.service().recover(plan.txId)).phase, 'rolledBack');
    await assert.rejects(readFile(path.join(f.game, 'oucl.session.lock')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(f.game, 'mods', 'new.jar')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('terminal recovery preserves foreign leases and refuses an unrecognized ledger commit', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async point => { if (point === 'journal-committed') throw new SimulatedDistributionCrash(); };
    await assert.rejects(f.service().commit(plan), SimulatedDistributionCrash); const journal = (await f.ports.journals.read(plan.txId))!.data;
    f.recoverable(); delete f.ports.checkpoint; await writeFile(path.join(f.game, 'oucl.session.lock'), 'foreign-owner');
    assert.equal((await f.service().recover(plan.txId)).phase, 'committed'); assert.equal(await readFile(path.join(f.game, 'oucl.session.lock'), 'utf8'), 'foreign-owner');
    await writeFile(path.join(f.game, 'oucl.session.lock'), journal.leaseToken);
    const receipt = (await f.receipt())!; await f.ports.receipts.commit(plan.instanceId, receipt.revision, { ...receipt.data, txId: randomUUID() });
    await assert.rejects(f.service().recover(plan.txId), errorCode('NEEDS_RECOVERY'));
    assert.equal(await readFile(path.join(f.game, 'oucl.session.lock'), 'utf8'), journal.leaseToken);
  } finally { await f.close(); }
});

test('lost journal acknowledgements reconcile exact durable records without publishing twice', async () => {
  const f = await fixture();
  try {
    const write = f.ports.journals.write; let lost = false;
    f.ports.journals.write = async (...args) => { const saved = await write(...args); if (!lost) { lost = true; throw new Error('TIMEOUT'); } return saved; };
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    assert.equal((await f.service().commit(plan)).phase, 'committed'); assert.equal((await f.receipt())!.revision, 1);
    assert.equal((await lstat(path.join(f.game, 'mods', 'new.jar'))).nlink, 1);
  } finally { await f.close(); }
});

test('lease replacement during staging stops before publication and preserves the foreign lease', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async point => { if (point === 'staged') await writeFile(path.join(f.game, 'oucl.session.lock'), 'foreign-owner'); };
    await assert.rejects(f.service().commit(plan), errorCode('NEEDS_RECOVERY'));
    assert.equal(await readFile(path.join(f.game, 'oucl.session.lock'), 'utf8'), 'foreign-owner');
    await assert.rejects(readFile(path.join(f.game, 'mods', 'new.jar')), { code: 'ENOENT' });
    assert.equal(await f.receipt(), undefined);
  } finally { await f.close(); }
});

test('in-place external changes to a published inode are retained instead of rolled back', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async point => { if (point === 'published') { await writeFile(path.join(f.game, 'mods', 'new.jar'), 'external-in-place'); throw new Error('interrupted'); } };
    await assert.rejects(f.service().commit(plan), errorCode('NEEDS_RECOVERY'));
    assert.equal(await readFile(path.join(f.game, 'mods', 'new.jar'), 'utf8'), 'external-in-place'); assert.equal(await f.receipt(), undefined);
  } finally { await f.close(); }
});

test('external replacement during a crashed publication is preserved with needsRecovery and lease evidence', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('owned'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async point => { if (point === 'published') throw new SimulatedDistributionCrash(); };
    await assert.rejects(f.service().commit(plan), SimulatedDistributionCrash);
    await unlink(path.join(f.game, 'mods', 'new.jar')); await writeFile(path.join(f.game, 'mods', 'new.jar'), 'external');
    f.recoverable(); delete f.ports.checkpoint;
    await assert.rejects(f.service().recover(plan.txId), errorCode('NEEDS_RECOVERY'));
    assert.equal(await readFile(path.join(f.game, 'mods', 'new.jar'), 'utf8'), 'external');
    assert.equal((await f.ports.journals.read(plan.txId))!.data.phase, 'needsRecovery');
    assert.equal(await readFile(path.join(f.game, 'oucl.session.lock'), 'utf8'), (await f.ports.journals.read(plan.txId))!.data.leaseToken);
  } finally { await f.close(); }
});

test('existing game lease, live sessions and changed target revision block distribution mutation', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('new'); const operations: DistributionOperation[] = [{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }];
    await writeFile(path.join(f.game, 'oucl.session.lock'), 'foreign-owner');
    await assert.rejects(f.service().commit(f.plan(operations)), errorCode('INSTANCE_BUSY'));
    assert.equal(await readFile(path.join(f.game, 'oucl.session.lock'), 'utf8'), 'foreign-owner'); await unlink(path.join(f.game, 'oucl.session.lock'));
    const plan = f.plan(operations); f.changeRevision(); await assert.rejects(f.service().commit(plan), errorCode('FILES_CHANGED'));
    f.busy(); await assert.rejects(f.service().commit(f.plan(operations)), errorCode('INSTANCE_BUSY'));
    await assert.rejects(readFile(path.join(f.game, 'mods', 'new.jar')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('unknown journal versions and tampered lease/pending/manifest proof stop recovery before file access', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('new'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async (point: DistributionTransactionCheckpoint) => { if (point === 'staged') throw new SimulatedDistributionCrash(); };
    await assert.rejects(f.service().commit(plan), SimulatedDistributionCrash);
    const journal = (await f.ports.journals.read(plan.txId))!.data;
    for (const invalid of [{ ...journal, formatVersion: 3 }, { ...journal, formatVersion: 1 }, { ...journal, gameIdentity: { dev: '1', ino: '0' } }, { ...journal, leaseToken: 'foreign' }, { ...journal, planDigest: 'a'.repeat(64) },
      { ...journal, pending: { index: 0, step: 'publish' } }, { ...journal, phase: 'applying', pending: { index: 0, step: ['publish'] } },
      { ...journal, files: [{ ...journal.files[0], operationIndex: 42 }] }]) assert.throws(() => parseDistributionJournal(invalid), errorCode('INVALID_TRANSACTION'));
    assert.throws(() => assertDistributionJournalTransition(journal, { ...journal, phase: 'applying', leaseToken: randomUUID() }), errorCode('INVALID_TRANSACTION'));
    assert.throws(() => assertDistributionJournalTransition(journal, { ...journal, phase: 'applying', gameIdentity: { ...journal.gameIdentity, ino: '1' } }), errorCode('INVALID_TRANSACTION'));
    assert.throws(() => assertDistributionJournalTransition(undefined, { ...journal, phase: 'applying' }), errorCode('INVALID_TRANSACTION'));
  } finally { await f.close(); }
});

test('recovery refuses a replacement game-directory inode even with matching persisted token and file bytes', async () => {
  const f = await fixture();
  try {
    const bytes = await f.source('root-bound'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    f.ports.checkpoint = async point => { if (point === 'staged') throw new SimulatedDistributionCrash(); };
    await assert.rejects(f.service().commit(plan), SimulatedDistributionCrash);
    const journal = (await f.ports.journals.read(plan.txId))!.data;
    await rename(f.game, path.join(f.base, 'original-game'));
    await mkdir(f.game); await writeFile(path.join(f.game, 'oucl.session.lock'), journal.leaseToken);
    await writeFile(path.join(f.game, 'sentinel'), 'new-directory-kept'); f.recoverable();
    await assert.rejects(f.service().recover(plan.txId), errorCode('FILES_CHANGED'));
    assert.equal(await readFile(path.join(f.game, 'sentinel'), 'utf8'), 'new-directory-kept');
    assert.equal(await readFile(path.join(f.game, 'oucl.session.lock'), 'utf8'), journal.leaseToken);
    await assert.rejects(readFile(path.join(f.game, 'mods', 'new.jar')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('linked target ancestors are never followed by the transaction', async () => {
  const f = await fixture();
  try {
    const external = path.join(f.base, 'external'); await mkdir(external); await writeFile(path.join(external, 'sentinel'), 'preserve');
    await symlink(external, path.join(f.game, 'mods'), process.platform === 'win32' ? 'junction' : 'dir');
    const bytes = await f.source('new'); await assert.rejects(f.service().commit(f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }])));
    assert.equal(await readFile(path.join(external, 'sentinel'), 'utf8'), 'preserve');
    await assert.rejects(readFile(path.join(external, 'new.jar')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('cancellation signal reaches artifact work through the transaction local cancel controller', async () => {
  const f = await fixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const finished = new Promise<void>(resolve => { release = resolve; });
  try {
    const bytes = await f.source('cancel-artifact'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    const artifact = f.ports.artifact; let observed: AbortSignal | undefined;
    f.ports.artifact = async (current, index, signal?: AbortSignal) => { observed = signal; enter(); await finished; return artifact(current, index); };
    const service = f.service(); const pending = service.commit(plan); const rejected = assert.rejects(pending, errorCode('CANCELLED'));
    try {
      await entered; await service.cancel(plan.txId);
      assert.ok(observed, 'artifact must receive the combined transaction signal'); assert.equal(observed.aborted, true);
    } finally { release(); await rejected; }
  } finally { await f.close(); }
});

test('cancelled artifact late success cannot start a new copy or persist a journal', async () => {
  const f = await fixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const finished = new Promise<void>(resolve => { release = resolve; });
  try {
    const bytes = await f.source('late-artifact'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    let copies = 0; const artifact = f.ports.artifact;
    f.ports.artifact = async (current, index) => { enter(); await finished; return artifact(current, index); };
    f.ports.createFiles = (game, txId, expectedRoot) => {
      const files = new DistributionTransactionFiles(game, txId, expectedRoot ? { expectedRoot } : {}); const copy = files.copy.bind(files);
      files.copy = async (...args) => { copies++; return copy(...args); }; return files;
    };
    const service = f.service(); const pending = service.commit(plan); const rejected = assert.rejects(pending, errorCode('CANCELLED'));
    try { await entered; await service.cancel(plan.txId); }
    finally { release(); await rejected; }
    assert.equal(copies, 0, 'late artifact success must not launch filesystem copying');
    assert.equal(await f.ports.journals.read(plan.txId), undefined);
    await assert.rejects(readFile(path.join(f.game, 'oucl.session.lock')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('cancellation after receipt commit starts cannot interrupt its acknowledgement or committed cleanup', async () => {
  const f = await fixture(); const controller = new AbortController(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  try {
    const bytes = await f.source('commit-in-flight'); const plan = f.plan([{ kind: 'add', area: 'mods', path: 'new.jar', artifactId: 'a', ...bytes }]);
    const commit = f.ports.receipts.commit; f.ports.receipts.commit = async (...args) => { enter(); await settled; return commit(...args); };
    const service = f.service(); const pending = service.commit(plan, controller.signal);
    try {
      await entered; assert.equal(await f.receipt(), undefined, 'the atomic commit has not acknowledged yet');
      await assert.rejects(service.cancel(plan.txId), errorCode('CANCEL_TOO_LATE')); controller.abort();
    } finally { release(); await pending; }
    assert.equal((await f.ports.journals.read(plan.txId))?.data.phase, 'committed');
    assert.equal((await f.receipt())?.data.txId, plan.txId);
    assert.equal(await readFile(path.join(f.game, 'mods', 'new.jar'), 'utf8'), 'commit-in-flight');
    assert.equal((await lstat(path.join(f.game, 'mods', 'new.jar'))).nlink, 1);
    await assert.rejects(readFile(path.join(f.game, 'oucl.session.lock')), { code: 'ENOENT' });
  } finally { release(); await f.close(); }
});
