import { useEffect, useRef, useState } from 'react';
import { useLauncher } from './launcher-state.js';
import { activeTask } from './task-query.js';
import { InstallTask } from './InstallPanel.js';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { TaskSnapshot } from '../shared/contracts/instances.js';

const KINDS: Record<TaskSnapshot['kind'], MessageKey> = {
  install: 'taskKindInstall', launch: 'launchGame', stop: 'taskKindStop', download: 'taskKindDownload',
  'mod-check': 'modsCheck', 'mod-install': 'taskKindModInstall', 'distribution-install': 'taskKindDistributionInstall',
};
// Mounting another page of already settled records must not replace the history cursor.
const historicalSettled = (): void => {};

function DistributionRecovery({ taskId, refresh }: { taskId: string; refresh: () => Promise<void> }) {
  const requestId = useRef<string | undefined>(undefined);
  const alive = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<MessageKey>();
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  async function recover(): Promise<void> {
    const bridge = window.oucl;
    if (busy || !bridge) return;
    setBusy(true); setMessage(undefined);
    try {
      const result = await bridge.recoverDistributionExecution(requestId.current ??= crypto.randomUUID(), taskId);
      if (!alive.current) return;
      setMessage(result.ok ? 'distributionRecoveryAccepted' : result.error.messageKey);
      if (result.ok) await refresh();
    } catch { if (alive.current) setMessage('unavailable'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div>
    <button disabled={busy} onClick={() => { void recover(); }}>{MESSAGES.distributionRecoverTask}</button>
    {message && <p role="status">{MESSAGES[message]}</p>}
  </div>;
}
/** Global, path-free task records. Target identity is shown only when the public contract proves it. */
export function TaskCenter({ distributionExecutionEnabled = false }: { distributionExecutionEnabled?: boolean }) {
  const state = useLauncher(); const [shown, setShown] = useState(20);
  const active = state.tasks.filter(activeTask); const recovery = state.tasks.filter(task => task.state === 'needsRecovery');
  const history = state.tasks.filter(task => !activeTask(task) && task.state !== 'needsRecovery');
  const ordered = [...active, ...recovery, ...history];
  if (!state.rootId) return null;
  return <section className="panel" aria-label={MESSAGES.taskCenterTitle}>
    <div className="section-heading"><h2>{MESSAGES.taskCenterTitle}</h2><button disabled={state.gameListBusy} onClick={() => { void state.refreshGame(); }}>{MESSAGES.taskRefresh}</button></div>
    <p role="status">{MESSAGES.taskLoadedActive} {active.length} · {MESSAGES.taskRecoveryCount} {recovery.length} · {MESSAGES.taskLoadedHistory} {history.length}</p>
    <p className="storage-note">{MESSAGES.taskCountsHint}</p>
    {state.historyBrowsing && <p className="storage-note">{MESSAGES.taskHistoryBrowsing}</p>}
    {state.historyRestarted && <p role="status" className="storage-note">{MESSAGES.taskHistoryRestarted}</p>}
    {!state.tasksComplete && <p role="status">{MESSAGES.taskListPartial}</p>}
    {state.gameListError && <p role="alert">{MESSAGES[state.gameListError]}</p>}
    {ordered.slice(0, shown).map(task => <div key={task.taskId}>
      <p>{MESSAGES[KINDS[task.kind]]} · <code>{task.taskId}</code>{task.state === 'paused' && <> · {MESSAGES.taskPaused}</>}</p>
      <InstallTask initial={task} onSettled={activeTask(task) ? state.refreshGame : historicalSettled} />
      {distributionExecutionEnabled && task.kind === 'distribution-install' && task.state === 'needsRecovery'
        && <DistributionRecovery taskId={task.taskId} refresh={state.refreshGame} />}
    </div>)}
    {shown < ordered.length && <button onClick={() => { setShown(value => value + 20); }}>{MESSAGES.taskShowMore}</button>}
    {!state.tasksComplete && <button disabled={state.gameListBusy} onClick={() => { void state.loadMoreGame(); }}>{MESSAGES.taskLoadPending}</button>}
    {!state.historyComplete && <button disabled={state.gameListBusy} onClick={() => { void state.loadMoreGame(true); }}>{MESSAGES.taskLoadHistory}</button>}
    {state.gameListBusy && <p role="status">{MESSAGES.taskLoading}</p>}
  </section>;
}
