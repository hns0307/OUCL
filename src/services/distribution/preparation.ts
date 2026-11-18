import { randomUUID } from 'node:crypto';
import { ReleaseError } from '../../core/distribution/release.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import {
  DISTRIBUTION_EXECUTION_MAX_ACTIVE, DISTRIBUTION_EXECUTION_MAX_SEEN, DISTRIBUTION_EXECUTION_PREPARE_TIMEOUT_MS,
  DISTRIBUTION_EXECUTION_PROPOSAL_TTL_MS,
  distributionExecutionFailure, isDistributionExecutionProposal, isDistributionExecutionPayload,
} from '../../shared/contracts/distribution-execution.js';
import type { DistributionExecutionBinding, DistributionExecutionCode, DistributionExecutionPreparation, DistributionExecutionProposal } from '../../shared/contracts/distribution-execution.js';
import { DistributionExecutionLifecycleError } from './execution.js';
import type { DistributionExecutionCoordinator } from './execution.js';
import { DistributionTransactionError, transactionDigest } from './transaction-record.js';

export class DistributionPreparationError extends Error {
  constructor(readonly code: DistributionExecutionCode) { super(code); this.name = 'DistributionPreparationError'; }
}

interface Entry {
  owner: symbol;
  digest: string;
  view: DistributionExecutionPreparation;
  timer?: ReturnType<typeof setTimeout>;
  confirming?: symbol;
  revoked?: boolean;
}

function prepareCode(error: unknown): DistributionExecutionCode {
  if (error instanceof ReleaseError) {
    switch (error.code) {
      case 'RELEASE_EXPIRED': case 'RELEASE_DOWNGRADE': case 'RELEASE_EQUIVOCATION': case 'CANCELLED': return error.code;
      case 'RELEASE_TIMEOUT': return 'TIMEOUT';
      default: return 'UNTRUSTED_DISTRIBUTION';
    }
  }
  if (error instanceof DistributionTransactionError) {
    return error.code === 'INVALID_TRANSACTION' ? 'INVALID_ARGUMENT' : error.code;
  }
  if (error instanceof DistributionExecutionLifecycleError) {
    if (error.code === 'EXECUTION_ACTIVE_LIMIT' || error.code === 'EXECUTION_IDENTITY_LIMIT') return 'CAPACITY_EXCEEDED';
    if (error.code === 'EXECUTION_REQUEST_EXPIRED') return 'PROPOSAL_EXPIRED';
  }
  return 'UNAVAILABLE';
}

/** Shares one preparation budget across document generations owned by the same root. */
export class DistributionPreparationService {
  private readonly entries = new Map<string, Entry>();
  private readonly jobs = new Set<Promise<unknown>>();
  private readonly preparing = new Set<Promise<void>>();
  private closed = false;
  private closing?: Promise<void>;

  constructor(private readonly coordinator: Pick<DistributionExecutionCoordinator, 'prepare' | 'cancel'>,
    private readonly now: () => number = Date.now) {}

  private track<T>(job: Promise<T>): Promise<T> {
    this.jobs.add(job);
    const off = () => { this.jobs.delete(job); };
    void job.then(off, off);
    return job;
  }

  private set(entry: Entry, view: DistributionExecutionPreparation): void {
    clearTimeout(entry.timer);
    delete entry.timer;
    entry.view = view;
  }

  private stop(entry: Entry, state: 'cancelled' | 'expired'): void {
    const prepareRequestId = entry.view.prepareRequestId;
    if (entry.view.state !== 'pending' && entry.view.state !== 'ready') return;
    this.set(entry, { prepareRequestId, state, proposal: null, error: null });
    this.track(Promise.resolve().then(() => this.coordinator.cancel(prepareRequestId)).catch(() => {}));
  }

  private fail(entry: Entry, code: DistributionExecutionCode): void {
    const prepareRequestId = entry.view.prepareRequestId;
    const failure = distributionExecutionFailure(prepareRequestId, code, randomUUID());
    if (!failure.ok) this.set(entry, { prepareRequestId, state: 'failed', proposal: null, error: failure.error });
  }

  private available(): void {
    if (this.closed) throw new DistributionPreparationError('UNAVAILABLE');
  }

  private owned(owner: symbol, id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner || entry.revoked) throw new DistributionPreparationError('INVALID_ARGUMENT');
    if (entry.view.state === 'ready' && !entry.confirming && entry.view.proposal.expiresAt <= this.now()) this.stop(entry, 'expired');
    return entry;
  }

  prepare(owner: symbol, id: string, input: DistributionExecutionBinding): DistributionExecutionPreparation {
    this.available();
    if (typeof id !== 'string' || id !== id.toLowerCase() || !UUID_PATTERN.test(id) || !isDistributionExecutionPayload(input, 'distribution:prepareExecution')) {
      throw new DistributionPreparationError('INVALID_ARGUMENT');
    }
    const binding = structuredClone(input);
    const digest = transactionDigest([binding.rootId, binding.instanceId, binding.sourceId, binding.packageId, binding.packageVersion]);
    if (this.entries.has(id)) {
      const previous = this.owned(owner, id);
      if (previous.digest !== digest) throw new DistributionPreparationError('REQUEST_CONFLICT');
      return structuredClone(previous.view);
    }
    const active = [...this.entries.values()].filter(entry => entry.confirming || entry.view.state === 'pending' || entry.view.state === 'ready').length;
    if (active >= DISTRIBUTION_EXECUTION_MAX_ACTIVE || this.jobs.size >= DISTRIBUTION_EXECUTION_MAX_ACTIVE
      || this.entries.size >= DISTRIBUTION_EXECUTION_MAX_SEEN) throw new DistributionPreparationError('CAPACITY_EXCEEDED');
    const entry: Entry = { owner, digest, view: { prepareRequestId: id, state: 'pending', proposal: null, error: null } };
    this.entries.set(id, entry);
    entry.timer = setTimeout(() => {
      this.stop(entry, 'expired');
    }, DISTRIBUTION_EXECUTION_PREPARE_TIMEOUT_MS);
    const work = this.track(Promise.resolve().then(async () => {
      if (entry.view.state !== 'pending') return;
      try {
        const prepared = await this.coordinator.prepare(id, binding);
        if (entry.view.state !== 'pending') return;
        const proposal: DistributionExecutionProposal = {
          proposalId: prepared.proposalId, rootId: prepared.rootId, instanceId: prepared.instanceId,
          sourceId: prepared.sourceId, packageId: prepared.packageId, packageVersion: prepared.packageVersion,
          instanceRevision: prepared.instanceRevision, sequence: prepared.sequence, expiresAt: prepared.expiresAt,
          changes: prepared.changes.flatMap(({ area, path, kind }) => kind === 'keep' ? [] : [{ area, path, kind }]),
          conflicts: prepared.conflicts.map(({ area, path, code }) => ({ area, path, code })),
        };
        if (!isDistributionExecutionProposal(proposal) || proposal.proposalId !== id
          || proposal.rootId !== binding.rootId || proposal.instanceId !== binding.instanceId || proposal.sourceId !== binding.sourceId
          || proposal.packageId !== binding.packageId || proposal.packageVersion !== binding.packageVersion) {
          this.stop(entry, 'cancelled');
          this.fail(entry, 'UNAVAILABLE');
          return;
        }
        const remaining = proposal.expiresAt - this.now();
        if (remaining <= 0) { this.stop(entry, 'expired'); return; }
        if (remaining > DISTRIBUTION_EXECUTION_PROPOSAL_TTL_MS) {
          this.stop(entry, 'cancelled');
          this.fail(entry, 'UNAVAILABLE');
          return;
        }
        this.set(entry, { prepareRequestId: id, state: 'ready', proposal: structuredClone(proposal), error: null });
        entry.timer = setTimeout(() => { if (!entry.confirming) this.stop(entry, 'expired'); }, remaining);
      } catch (error) {
        if (entry.view.state === 'pending') this.fail(entry, prepareCode(error));
      }
    }).finally(() => { this.preparing.delete(work); }));
    this.preparing.add(work);
    return structuredClone(entry.view);
  }

  get(owner: symbol, id: string): DistributionExecutionPreparation {
    this.available();
    return structuredClone(this.owned(owner, id).view);
  }

  cancel(owner: symbol, id: string): { cancelled: boolean } {
    this.available();
    const entry = this.owned(owner, id);
    if (entry.confirming) throw new DistributionPreparationError('CANCEL_TOO_LATE');
    this.stop(entry, 'cancelled');
    return { cancelled: entry.view.state === 'cancelled' };
  }

  /** A confirmation that has entered the durable path survives document revocation. */
  reserveConfirmation(owner: symbol, id: string, revision: number, sequence: number): (accepted: boolean) => void {
    this.available();
    const entry = this.owned(owner, id);
    if (entry.view.state === 'expired') throw new DistributionPreparationError('PROPOSAL_EXPIRED');
    if (entry.view.state !== 'ready' || entry.view.proposal.instanceRevision !== revision || entry.view.proposal.sequence !== sequence) {
      throw new DistributionPreparationError('REQUEST_CONFLICT');
    }
    if (entry.confirming) throw new DistributionPreparationError('INSTANCE_BUSY');
    const reservation = Symbol();
    entry.confirming = reservation;
    let finish!: () => void;
    this.track(new Promise<void>(resolve => { finish = resolve; }));
    return accepted => {
      if (entry.confirming !== reservation) return;
      delete entry.confirming;
      if (accepted) {
        entry.revoked = true;
        this.set(entry, { prepareRequestId: id, state: 'cancelled', proposal: null, error: null });
      } else if (entry.revoked || this.closed) this.stop(entry, 'cancelled');
      else if (entry.view.state === 'ready' && entry.view.proposal.expiresAt <= this.now()) this.stop(entry, 'expired');
      finish();
    };
  }

  revoke(owner: symbol): void {
    for (const entry of this.entries.values()) {
      if (entry.owner !== owner || entry.revoked) continue;
      entry.revoked = true;
      if (!entry.confirming) this.stop(entry, 'cancelled');
    }
  }

  /** A scheduler can stop admitting prepares and wait for their actual authority reads to finish. */
  async drainPreparing(): Promise<void> {
    await Promise.allSettled([...this.preparing]);
  }

  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => {
      for (const entry of this.entries.values()) if (!entry.confirming) this.stop(entry, 'cancelled');
      while (this.jobs.size) await Promise.allSettled([...this.jobs]);
      this.entries.clear();
    })();
  }
}
