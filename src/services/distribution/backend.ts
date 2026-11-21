import { randomUUID } from 'node:crypto';
import type { DistributionExecutionPort } from '../../ipc/distribution-execution.js';
import {
  distributionExecutionFailure, isDistributionExecutionRequest, isDistributionExecutionResult,
} from '../../shared/contracts/distribution-execution.js';
import type {
  DistributionExecutionChannel, DistributionExecutionCode, DistributionExecutionData, DistributionExecutionRequest, DistributionExecutionResult,
} from '../../shared/contracts/distribution-execution.js';
import { StorageError } from '../storage/files.js';
import type { AdmissionRepository } from './admission-record.js';
import { DistributionConfirmationError } from './confirmation.js';
import type { DistributionConfirmationService } from './confirmation.js';
import { DistributionPreparationError } from './preparation.js';
import type { DistributionPreparationService } from './preparation.js';
import type { DistributionExecutionRunner } from './runner.js';
import { DistributionTaskViewError } from './task-views.js';
import type { DistributionTaskViewProvider } from './task-views.js';

interface Ports {
  available(): boolean;
  admissions: Pick<AdmissionRepository, 'readByProposal' | 'bindRecoveryRequest'>;
  preparation: DistributionPreparationService;
  confirmation: Pick<DistributionConfirmationService, 'confirm'>;
  runner: Pick<DistributionExecutionRunner, 'run' | 'recover'>;
  views: Pick<DistributionTaskViewProvider, 'get'>;
  onJobFailure?(): void;
}

function code(error: unknown): DistributionExecutionCode {
  if (error instanceof DistributionPreparationError || error instanceof DistributionConfirmationError) return error.code;
  if (error instanceof StorageError) return error.code === 'REVISION_CONFLICT' ? 'REQUEST_CONFLICT' : 'NEEDS_RECOVERY';
  if (error instanceof DistributionTaskViewError && error.code === 'NEEDS_RECOVERY') return 'NEEDS_RECOVERY';
  return 'UNAVAILABLE';
}

/** Owns a serial queue of admitted work for one project root, independently of its documents. */
export class DistributionExecutionBackend {
  private tail: Promise<void> = Promise.resolve();
  private units = 0;
  private readonly scheduled = new Set<string>();
  private working = false;
  private closed = false;
  private closing?: Promise<void>;

  constructor(private readonly rootId: string, private readonly ports: Ports) {}

  private available(): boolean {
    return !this.closed && this.ports.available();
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(work);
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  private admitted<T>(work: (schedule: (mode: 'run' | 'recover', proposal: string, task: string) => void) => Promise<T>): Promise<T> {
    if (this.units + this.scheduled.size > 14) throw new DistributionPreparationError('CAPACITY_EXCEEDED');
    let reserved = 2;
    this.units += reserved;
    return this.serial(async () => {
      try {
        return await work((mode, proposal, task) => {
          if (this.scheduled.has(task) || this.closed) return;
          reserved--;
          this.units--;
          this.scheduled.add(task);
          void this.serial(async () => {
            try {
              if (this.closed) return;
              this.working = true;
              await this.ports.preparation.drainPreparing();
              if (!this.closed) await this.ports.runner[mode](proposal, task);
            } catch { this.ports.onJobFailure?.(); }
            finally {
              this.working = false;
              this.scheduled.delete(task);
            }
          }).catch(() => {});
        });
      } finally { this.units -= reserved; }
    });
  }

  document(): DistributionExecutionPort {
    const owner = Symbol();
    let revoked = false;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      this.ports.preparation.revoke(owner);
    };
    return {
      available: () => !revoked && this.available(),
      dispatch: (channel, request, signal) => this.dispatch(owner, channel, request, () => !revoked && !signal.aborted),
      revoke,
      close: async () => { revoke(); },
    };
  }

  private async dispatch(owner: symbol, channel: DistributionExecutionChannel, request: DistributionExecutionRequest,
    live: () => boolean): Promise<DistributionExecutionResult> {
    const trace = randomUUID();
    const ensureLive = () => {
      if (!live()) throw new DistributionPreparationError('INVALID_SENDER');
      if (!this.available()) throw new DistributionPreparationError('SOURCE_UNAVAILABLE');
    };
    const ok = (data: DistributionExecutionData[DistributionExecutionChannel]): DistributionExecutionResult => {
      const result: DistributionExecutionResult = { contractVersion: 1, requestId: request.requestId, ok: true, data };
      if (!isDistributionExecutionResult(result, request, channel)) throw new DistributionPreparationError('UNAVAILABLE');
      return result;
    };
    try {
      ensureLive();
      switch (channel) {
        case 'distribution:prepareExecution':
          if (isDistributionExecutionRequest(request, channel)) {
            if (request.payload.rootId !== this.rootId) throw new DistributionPreparationError('INVALID_ARGUMENT');
            if (this.working) throw new DistributionPreparationError('INSTANCE_BUSY');
            return ok(this.ports.preparation.prepare(owner, request.requestId, request.payload));
          }
          break;
        case 'distribution:executionPreparation':
          if (isDistributionExecutionRequest(request, channel)) return ok(this.ports.preparation.get(owner, request.payload.prepareRequestId));
          break;
        case 'distribution:cancelExecutionPreparation':
          if (isDistributionExecutionRequest(request, channel)) return ok(this.ports.preparation.cancel(owner, request.payload.prepareRequestId));
          break;
        case 'distribution:confirmExecution':
          if (isDistributionExecutionRequest(request, channel)) {
            const { requestId, payload } = request;
            return await this.admitted(async schedule => {
              ensureLive();
              const previous = await this.ports.admissions.readByProposal(payload.proposalId);
              ensureLive();
              const finish = previous ? undefined
                : this.ports.preparation.reserveConfirmation(owner, payload.proposalId, payload.instanceRevision, payload.sequence);
              let accepted = false;
              try {
                const result = await this.ports.confirmation.confirm(requestId, payload);
                accepted = true;
                if (finish && result.snapshot.state === 'queued') schedule('run', result.proposalId, result.taskId);
                return ok(result);
              } finally { finish?.(accepted); }
            });
          }
          break;
        case 'distribution:recoverExecution':
          if (isDistributionExecutionRequest(request, channel)) {
            const { requestId, payload } = request;
            return await this.admitted(async schedule => {
              ensureLive();
              const view = await this.ports.views.get(payload.taskId);
              if (!view || !['needsRecovery', 'completed', 'failed'].includes(view.snapshot.state)) {
                throw new DistributionPreparationError('NEEDS_RECOVERY');
              }
              ensureLive();
              const record = await this.ports.admissions.bindRecoveryRequest(this.rootId, requestId, payload.taskId);
              if (view.snapshot.state === 'needsRecovery') schedule('recover', record.proposalId, record.taskId);
              return ok({ taskId: record.taskId, recoveryRequestId: requestId, snapshot: view.snapshot });
            });
          }
      }
      return distributionExecutionFailure(request.requestId, 'INVALID_ARGUMENT', trace);
    } catch (error) { return distributionExecutionFailure(request.requestId, code(error), trace); }
  }

  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => {
      await this.ports.preparation.close();
      await this.tail;
    })();
  }
}
