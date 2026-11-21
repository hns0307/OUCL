import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readAdmittedTerminal } from '../src/services/distribution/admitted-terminal.js';
import type { AdmittedTerminalPorts } from '../src/services/distribution/admitted-terminal.js';
import { MAX_RECORD_BYTES } from '../src/services/storage/files.js';
import { transactionDigest } from '../src/services/distribution/transaction-record.js';
import { confirmationFixture } from './helpers/distribution-confirmation-fixture.js';
import { localJar } from './helpers/distribution-local-domain-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
async function admitted() {
  const f = await confirmationFixture();
  try {
    const requestId = randomUUID(); await f.service().confirm(requestId, f.input);
    const admission = await f.admissions.readByRequest(requestId); assert.ok(admission); assert.equal(admission.phase, 'projected');
    const ports: AdmittedTerminalPorts = { journals: { read: id => f.domain.store.journals.read(id) }, receipts: { read: id => f.domain.store.receipts.read(id) } };
    return { f, admission, ports };
  } catch (error) { await f.close(); throw error; }
}
async function terminal(phase: 'committed' | 'rolledBack') {
  const v = await admitted();
  try {
    if (phase === 'committed') assert.equal((await v.f.coordinator.confirm(v.f.plan.txId)).phase, 'committed');
    else {
      const service = await v.f.domain.transaction(async point => { if (point === 'staged') throw new Error('SYNTHETIC_STAGED_FAILURE'); });
      await assert.rejects(service.commit(v.f.plan), { code: 'NEEDS_RECOVERY' });
    }
    const journal = await v.ports.journals.read(v.f.plan.txId); assert.ok(journal); assert.equal(journal.data.phase, phase);
    const receipt = await v.ports.receipts.read(v.f.plan.instanceId);
    return { ...v, journal, receipt };
  } catch (error) { await v.f.close(); throw error; }
}

test('stable absence is undefined; real admitted/native committed evidence is thin, detached and read-only', WINDOWS, async () => {
  const v = await admitted();
  try {
    const order: string[] = [];
    const observed: AdmittedTerminalPorts = { journals: { read: async id => { order.push('J'); return v.ports.journals.read(id); } },
      receipts: { read: async id => { order.push('R'); return v.ports.receipts.read(id); } } };
    assert.equal(await readAdmittedTerminal(v.f.plan.rootId, v.admission, observed), undefined); assert.deepEqual(order, ['J', 'R', 'J', 'R']);
    assert.equal((await v.f.client.readDistributionTaskProjections(v.f.plan.rootId))[0]?.task.execution.state, 'queued');
    await v.f.coordinator.confirm(v.f.plan.txId);
    const journal = await v.ports.journals.read(v.f.plan.txId); const receipt = await v.ports.receipts.read(v.f.plan.instanceId); assert.ok(journal); assert.ok(receipt);
    const before = transactionDigest([journal, receipt, await v.f.admissions.listAll()]);
    const evidence = await readAdmittedTerminal(v.f.plan.rootId, v.admission, observed); assert.ok(evidence);
    assert.deepEqual(evidence, { proposalId: v.f.plan.txId, taskId: v.admission.taskId, planDigest: transactionDigest(v.f.plan),
      gameIdentity: v.admission.gameIdentity, phase: 'committed', journalRevision: journal.revision, receiptRevision: receipt.revision });
    evidence.gameIdentity.ino = '999';
    assert.deepEqual((await readAdmittedTerminal(v.f.plan.rootId, v.admission, v.ports))?.gameIdentity, v.admission.gameIdentity);
    assert.equal(transactionDigest([await v.ports.journals.read(v.f.plan.txId), await v.ports.receipts.read(v.f.plan.instanceId), await v.f.admissions.listAll()]), before);
    assert.deepEqual(await readFile(path.join(v.f.domain.gameDir, 'mods', 'managed.jar')), v.f.artifact.bytes);
  } finally { await v.f.close(); }
});

test('real staged failure rolls back via native factory and proves absent before-receipt at revision zero', WINDOWS, async () => {
  const v = await terminal('rolledBack');
  try {
    assert.equal(v.receipt, undefined); assert.deepEqual(await readdir(path.join(v.f.domain.gameDir, 'mods')), []);
    const evidence = await readAdmittedTerminal(v.f.plan.rootId, v.admission, v.ports); assert.ok(evidence);
    assert.equal(evidence.phase, 'rolledBack'); assert.equal(evidence.receiptRevision, 0); assert.equal(evidence.journalRevision, v.journal.revision);
    assert.deepEqual(await v.ports.journals.read(v.f.plan.txId), v.journal);
  } finally { await v.f.close(); }
});

test('malicious admission/root/journal bindings cannot certify a real terminal', WINDOWS, async () => {
  const v = await terminal('committed');
  try {
    await assert.rejects(readAdmittedTerminal(randomUUID(), v.admission, v.ports), { code: 'NEEDS_RECOVERY' });
    for (const admission of [{ ...v.admission, taskId: 'invalid' }, { ...v.admission, plan: { ...v.admission.plan, instanceRevision: 2 } },
      { ...v.admission, gameIdentity: { ...v.admission.gameIdentity, ino: '999' } }]) {
      await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, admission, v.ports), { code: 'NEEDS_RECOVERY' });
    }
    const changed = structuredClone(v.journal); changed.data.gameIdentity.ino = '999';
    await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, { ...v.ports, journals: { read: async () => changed } }), { code: 'NEEDS_RECOVERY' });
  } finally { await v.f.close(); }
});

test('partial/pending journals and wrong committed or rolled-back receipt direction are not terminal evidence', WINDOWS, async () => {
  const v = await terminal('committed');
  try {
    for (const phase of ['prepared', 'applying', 'needsRecovery'] as const) {
      const partial = structuredClone(v.journal); partial.data.phase = phase;
      await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, { ...v.ports, journals: { read: async () => partial } }), { code: 'NEEDS_RECOVERY' });
    }
    const pending = structuredClone(v.journal); pending.data.pending = { index: 0, step: 'publish' };
    await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, { ...v.ports, journals: { read: async () => pending } }), { code: 'NEEDS_RECOVERY' });
    await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, { ...v.ports, receipts: { read: async () => undefined } }), { code: 'NEEDS_RECOVERY' });
    const rollback = structuredClone(v.journal); rollback.data.phase = 'rolledBack';
    await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, { ...v.ports, journals: { read: async () => rollback } }), { code: 'NEEDS_RECOVERY' });
  } finally { await v.f.close(); }
});

test('a genuinely newer native receipt conservatively refuses the old admitted terminal', WINDOWS, async () => {
  const v = await terminal('committed');
  try {
    const artifact = await v.f.domain.artifact(localJar('second_mod'), 'second_mod');
    const next = v.f.domain.plan([v.f.domain.add(artifact, 'second.jar')]); await v.f.domain.accept(next);
    assert.equal((await (await v.f.domain.transaction()).commit(next)).phase, 'committed');
    assert.equal((await v.ports.receipts.read(v.f.plan.instanceId))?.revision, 2);
    await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, v.ports), { code: 'NEEDS_RECOVERY' });
    assert.deepEqual(await readFile(path.join(v.f.domain.gameDir, 'mods', 'managed.jar')), v.f.artifact.bytes);
    assert.deepEqual(await readFile(path.join(v.f.domain.gameDir, 'mods', 'second.jar')), artifact.bytes);
  } finally { await v.f.close(); }
});

test('journal and receipt envelope drift across J1/R1/J2/R2 are rejected', WINDOWS, async () => {
  const v = await terminal('committed');
  try {
    for (const drift of ['journal', 'receipt'] as const) {
      let journals = 0; let receipts = 0;
      await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, {
        journals: { read: async () => { const value = structuredClone(v.journal); if (drift === 'journal' && ++journals === 2) value.revision++; return value; } },
        receipts: { read: async () => { const value = structuredClone(v.receipt); assert.ok(value); if (drift === 'receipt' && ++receipts === 2) value.revision++; return value; } },
      }), { code: 'NEEDS_RECOVERY' });
    }
  } finally { await v.f.close(); }
});

test('untrusted port envelope budgets, extra keys, cycles and read failures fail closed without storage writes', WINDOWS, async () => {
  const v = await terminal('committed');
  try {
    const before = transactionDigest([v.journal, v.receipt]);
    for (const scenario of ['oversize', 'extra', 'cycle', 'throw', 'unsafe-revision'] as const) {
      await assert.rejects(readAdmittedTerminal(v.f.plan.rootId, v.admission, { ...v.ports, journals: { read: async () => {
        if (scenario === 'throw') throw new Error('synthetic-private-path');
        if (scenario === 'oversize') return { ...v.journal, padding: 'x'.repeat(MAX_RECORD_BYTES + 129) };
        if (scenario === 'extra') return { ...v.journal, extra: true };
        if (scenario === 'unsafe-revision') return { ...v.journal, revision: Number.MAX_SAFE_INTEGER + 1 };
        const cyclic = structuredClone(v.journal) as typeof v.journal & { self?: unknown }; cyclic.self = cyclic; return cyclic;
      } } }), { code: 'NEEDS_RECOVERY' });
    }
    assert.equal(transactionDigest([await v.ports.journals.read(v.f.plan.txId), await v.ports.receipts.read(v.f.plan.instanceId)]), before);
  } finally { await v.f.close(); }
});
