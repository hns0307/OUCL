import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModInstallationState, ModInstallPlan } from '../shared/contracts/mods.js';
import { modFailure } from '../shared/contracts/mods.js';
import { MESSAGES, MOD_ISSUE_MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { InstallTask } from './InstallPanel.js';

/** Confirms only the saved evidence; after acceptance the common task owns cancellation and progress. */
export function ModInstallConfirmation({ plan, planRequestId, onAccepted, onRefresh }: {
  plan: ModInstallPlan; planRequestId: string; onAccepted: (accepted: boolean) => void; onRefresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState<ModInstallationState>(); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey>(); const requestId = useRef(crypto.randomUUID());
  const generation = useRef(0); const querying = useRef(false);
  const read = useCallback(async (): Promise<void> => {
    if (!window.oucl || querying.current) return; const ticket = generation.current; querying.current = true;
    try {
      const result = await window.oucl.modInstallState(planRequestId); if (ticket !== generation.current) return;
      if (result.ok) { setStatus(result.data); onAccepted(result.data.task !== null); if (result.data.task) setError(undefined); }
      else setError(result.error.messageKey);
    } catch { if (ticket === generation.current) setError('unavailable'); }
    finally { querying.current = false; }
  }, [planRequestId, onAccepted]);
  useEffect(() => {
    generation.current++; setStatus(undefined); setError(undefined); void read();
    const timer = setInterval(() => { void read(); }, 1200);
    return () => { generation.current++; clearInterval(timer); };
  }, [read]);
  const settled = useCallback(() => { void read(); void onRefresh(); }, [read, onRefresh]);
  async function confirm(): Promise<void> {
    if (!window.oucl || busy || !status || status.task) return; const ticket = generation.current; setBusy(true); setError(undefined);
    try {
      const result = await window.oucl.confirmModPlan(requestId.current, { planRequestId, planId: plan.planId, confirmed: true });
      if (ticket !== generation.current) return;
      if (result.ok) onAccepted(true); else setError(result.error.messageKey);
      await read(); await onRefresh();
    } catch { if (ticket === generation.current) setError('unavailable'); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  const failure = status?.errorCode ? modFailure(requestId.current, status.errorCode, requestId.current) : undefined;
  return <div className="mod-install-confirmation" data-install-state={status?.task?.state ?? 'preview'}>
    {status?.task ? <InstallTask key={status.task.taskId} initial={status.task} onSettled={settled} /> : <>
      <p className="muted small">{MESSAGES.modsInstallConsent}</p>
      <button className="primary" disabled={busy || !status || plan.state !== 'ready'} onClick={() => { void confirm(); }}>{busy ? MESSAGES.uiSubmitting : MESSAGES.modsInstallConfirm}</button>
    </>}
    {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
    {failure && !failure.ok && <p className="form-error" role="alert">{MESSAGES[failure.error.messageKey]}</p>}
    {!!status?.assessment?.issues.length && <details open><summary>{MESSAGES.modsFindings}</summary><ul>
      {status.assessment.issues.map((issue, index) => <li key={index}>
        {MOD_ISSUE_MESSAGES[issue.code] ?? MESSAGES.modsUnknownReason} · {issue.modId ?? issue.targetProjectId ?? MESSAGES.modsEnvironment}
        {issue.targetModId && <> → {issue.targetModId}</>}{issue.requirement && <> · {MESSAGES.modsRequirement}: {issue.requirement}</>}
        {!!issue.actual.length && <> · {MESSAGES.modsActual}: {issue.actual.join(', ')}</>}
      </li>)}
    </ul></details>}
  </div>;
}
