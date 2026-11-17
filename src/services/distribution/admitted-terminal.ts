import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { MAX_RECORD_BYTES } from '../storage/files.js';
import { parseAdmissionRecord } from './admission-record.js';
import type { AdmissionRecord } from './admission-record.js';
import { parseDistributionJournal, parseDistributionReceipt, transactionDigest } from './transaction-record.js';
import type { DirectoryProof, DistributionJournal, DistributionReceipt, JournalRepository, ReceiptRepository,
  TransactionEnvelope } from './transaction-record.js';

export interface AdmittedTerminalPorts {
  journals: Pick<JournalRepository, 'read'>;
  receipts: Pick<ReceiptRepository, 'read'>;
}
/** Historical private-metadata evidence only; never permission to start or replay file operations. */
export interface AdmittedTerminalEvidence {
  proposalId: string; taskId: string; planDigest: string; gameIdentity: DirectoryProof;
  phase: 'committed' | 'rolledBack'; journalRevision: number; receiptRevision: number;
}
export class DistributionAdmittedTerminalError extends Error {
  readonly code = 'NEEDS_RECOVERY';
  constructor() { super('NEEDS_RECOVERY'); this.name = 'DistributionAdmittedTerminalError'; }
}
function fail(): never { throw new DistributionAdmittedTerminalError(); }
function bytes(value: unknown, maximum: number): void {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || Buffer.byteLength(text) > maximum) fail();
}
function snapshot<T>(value: T, maximum = MAX_RECORD_BYTES + 128): T {
  bytes(value, maximum); return structuredClone(value);
}
function envelope<T>(value: unknown, parse: (raw: unknown) => T): TransactionEnvelope<T> | undefined {
  if (value === undefined) return;
  const raw = snapshot(value);
  if (!exactObject(raw, ['revision', 'data']) || typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 1) fail();
  bytes(raw.data, MAX_RECORD_BYTES);
  return { revision: raw.revision, data: parse(raw.data) };
}
function stable<T>(first: TransactionEnvelope<T> | undefined, second: TransactionEnvelope<T> | undefined): boolean {
  return first === undefined ? second === undefined : second !== undefined
    && first.revision === second.revision && transactionDigest(first.data) === transactionDigest(second.data);
}
function receipt(value: unknown, instanceId: string): TransactionEnvelope<DistributionReceipt> | undefined {
  const parsed = envelope(value, parseDistributionReceipt);
  if (parsed && parsed.data.instanceId !== instanceId) fail();
  return parsed;
}

/** Reads J/R/J/R with immediate bounded snapshots. Absence is not a fresh-claim or execution grant. */
export async function readAdmittedTerminal(expectedRootId: string, admission: AdmissionRecord,
  ports: AdmittedTerminalPorts): Promise<AdmittedTerminalEvidence | undefined> {
  try {
    if (typeof expectedRootId !== 'string' || !UUID_PATTERN.test(expectedRootId) || expectedRootId !== expectedRootId.toLowerCase()) fail();
    const record = parseAdmissionRecord(snapshot(admission));
    if (record.phase !== 'projected' || record.plan.rootId !== expectedRootId) fail();
    const firstJournal = envelope(await ports.journals.read(record.proposalId), parseDistributionJournal);
    const firstReceipt = receipt(await ports.receipts.read(record.plan.instanceId), record.plan.instanceId);
    const secondJournal = envelope(await ports.journals.read(record.proposalId), parseDistributionJournal);
    const secondReceipt = receipt(await ports.receipts.read(record.plan.instanceId), record.plan.instanceId);
    if (!stable(firstJournal, secondJournal) || !stable(firstReceipt, secondReceipt)) fail();
    if (!firstJournal) return;
    const journal: DistributionJournal = firstJournal.data;
    const planDigest = transactionDigest(record.plan);
    if (journal.planDigest !== planDigest || transactionDigest(journal.plan) !== planDigest
      || journal.plan.txId !== record.proposalId || journal.gameIdentity.dev !== record.gameIdentity.dev
      || journal.gameIdentity.ino !== record.gameIdentity.ino
      || journal.phase !== 'committed' && journal.phase !== 'rolledBack') fail();
    if (journal.phase === 'committed') {
      const revision = journal.beforeReceiptRevision + 1;
      if (!Number.isSafeInteger(revision) || !firstReceipt || firstReceipt.revision !== revision
        || transactionDigest(firstReceipt.data) !== transactionDigest(journal.afterReceipt)) fail();
    } else {
      if (journal.beforeReceipt === null ? firstReceipt !== undefined : firstReceipt === undefined) fail();
      if ((firstReceipt?.revision ?? 0) !== journal.beforeReceiptRevision
        || transactionDigest(firstReceipt?.data ?? null) !== transactionDigest(journal.beforeReceipt)) fail();
    }
    return { proposalId: record.proposalId, taskId: record.taskId, planDigest, gameIdentity: { ...record.gameIdentity },
      phase: journal.phase, journalRevision: firstJournal.revision, receiptRevision: firstReceipt?.revision ?? 0 };
  } catch { throw new DistributionAdmittedTerminalError(); }
}
