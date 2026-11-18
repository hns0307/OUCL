import { useEffect, useRef, useState } from 'react';
import type { DistributionExecutionBinding, DistributionExecutionPreparation } from '../shared/contracts/distribution-execution.js';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';

const LABELS = { add: 'distributionAdd', replace: 'distributionReplace', remove: 'distributionRemove' } as const;

export function DistributionExecutionControls({ binding, onTasks }: { binding: DistributionExecutionBinding; onTasks?: () => void }) {
  const [preparation, setPreparation] = useState<DistributionExecutionPreparation>();
  const [taskId, setTaskId] = useState<string>();
  const [error, setError] = useState<MessageKey>();
  const [busy, setBusy] = useState(false);
  const current = useRef<string | undefined>(undefined);
  const confirmId = useRef<string | undefined>(undefined);
  const confirming = useRef(false);
  const alive = useRef(false);
  const pendingId = preparation?.state === 'pending' ? preparation.prepareRequestId : undefined;
  const pending = Boolean(pendingId);
  const bridge = window.oucl;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (current.current && !confirming.current && !confirmId.current) {
        void bridge?.cancelDistributionExecutionPreparation(current.current).catch(() => {});
      }
    };
  }, [bridge]);

  useEffect(() => {
    if (!pendingId || !bridge) return;
    const id = pendingId;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await bridge.getDistributionExecutionPreparation(id);
        if (stopped || current.current !== id) return;
        if (result.ok) {
          setPreparation(result.data);
          if (result.data.state === 'pending') timer = setTimeout(() => { void poll(); }, 450);
        } else setError(result.error.messageKey);
      } catch { if (!stopped && current.current === id) setError('unavailable'); }
    };
    timer = setTimeout(() => { void poll(); }, 450);
    return () => { stopped = true; clearTimeout(timer); };
  }, [bridge, pendingId]);

  async function prepare(): Promise<void> {
    if (!bridge || busy) return;
    const previous = current.current;
    const id = confirmId.current ? undefined : previous;
    const requestId = id && (!preparation || preparation.state === 'pending') ? id : crypto.randomUUID();
    current.current = requestId;
    confirmId.current = undefined;
    setBusy(true); setError(undefined); setPreparation(undefined); setTaskId(undefined);
    try {
      if (previous && previous !== requestId) await bridge.cancelDistributionExecutionPreparation(previous).catch(() => {});
      if (!alive.current || current.current !== requestId) return;
      const result = await bridge.prepareDistributionExecution(requestId, binding);
      if (!alive.current || current.current !== requestId) return;
      if (result.ok) setPreparation(result.data); else setError(result.error.messageKey);
    } catch { if (alive.current && current.current === requestId) setError('unavailable'); }
    finally { if (alive.current && current.current === requestId) setBusy(false); }
  }

  async function cancel(): Promise<void> {
    const id = current.current;
    if (!id || !bridge || busy) return;
    setBusy(true);
    try {
      const result = await bridge.cancelDistributionExecutionPreparation(id);
      if (!alive.current || current.current !== id) return;
      if (result.ok && result.data.cancelled) {
        current.current = undefined;
        setPreparation({ prepareRequestId: id, state: 'cancelled', proposal: null, error: null });
        setError(undefined);
      } else if (!result.ok) setError(result.error.messageKey);
    } catch { if (alive.current && current.current === id) setError('unavailable'); }
    finally { if (alive.current) setBusy(false); }
  }

  async function confirm(): Promise<void> {
    const proposal = preparation?.proposal;
    if (!bridge || !proposal || busy || confirming.current || proposal.conflicts.length || !proposal.changes.length) return;
    const id = confirmId.current ??= crypto.randomUUID();
    confirming.current = true;
    setBusy(true); setError(undefined);
    try {
      const result = await bridge.confirmDistributionExecution(id, {
        proposalId: proposal.proposalId, instanceRevision: proposal.instanceRevision, sequence: proposal.sequence,
      });
      if (!alive.current || confirmId.current !== id) return;
      if (result.ok) {
        current.current = undefined;
        setTaskId(result.data.taskId);
        setPreparation(undefined);
      } else {
        setError(result.error.messageKey);
        if (result.error.code === 'PROPOSAL_EXPIRED' || result.error.code === 'FILES_CHANGED') {
          current.current = undefined;
          confirmId.current = undefined;
          setPreparation(undefined);
        }
      }
    } catch { if (alive.current && confirmId.current === id) setError('unavailable'); }
    finally { confirming.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="distribution-execution">
    {(!preparation || preparation.state === 'failed' || preparation.state === 'expired' || preparation.state === 'cancelled' || (pending && error))
      && <button type="button" disabled={busy} onClick={() => { void prepare(); }}>{MESSAGES.distributionPrepareExecution}</button>}
    {pending && <p role="status">{MESSAGES.distributionPreparingExecution}</p>}
    {(pending || preparation?.state === 'ready') && !confirmId.current
      && <button type="button" disabled={busy} onClick={() => { void cancel(); }}>{MESSAGES.distributionCancel}</button>}
    {preparation?.state === 'expired' && <p role="status">{MESSAGES.distributionProposalExpired}</p>}
    {preparation?.state === 'failed' && <p role="alert">{MESSAGES[preparation.error.messageKey]}</p>}
    {preparation?.state === 'ready' && <>
      <p>{MESSAGES.distributionChanges} ({preparation.proposal.changes.length}) · {MESSAGES.distributionConflicts} ({preparation.proposal.conflicts.length})</p>
      <ul>{preparation.proposal.changes.map(change => <li key={`${change.area}/${change.path}`}>{MESSAGES[LABELS[change.kind]]} · {change.area}/{change.path}</li>)}</ul>
      <ul>{preparation.proposal.conflicts.map(conflict => <li key={`${conflict.area}/${conflict.path}`}>{conflict.area}/{conflict.path}</li>)}</ul>
      <button type="button" disabled={busy || !!preparation.proposal.conflicts.length || !preparation.proposal.changes.length}
        onClick={() => { void confirm(); }}>{MESSAGES[confirmId.current ? 'distributionRetryConfirmation' : 'distributionConfirmExecution']}</button>
    </>}
    {taskId && <p role="status">{MESSAGES.distributionTaskAccepted} <code>{taskId}</code> {onTasks && <button type="button" onClick={onTasks}>{MESSAGES.taskCenterTitle}</button>}</p>}
    {error && <p role="alert">{MESSAGES[error]}</p>}
  </div>;
}
