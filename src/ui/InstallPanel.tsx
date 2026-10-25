import { useCallback, useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { InstanceSummary, InstallStage, TaskSnapshot } from '../shared/contracts/instances.js';

const STAGE_MESSAGES: Record<InstallStage, MessageKey> = { metadata: 'stageMetadata', downloading: 'stageDownloading', materializing: 'stageMaterializing',
  committing: 'stageCommitting', completed: 'stageCompleted', failed: 'stageFailed', cancelled: 'stageCancelled', needsRecovery: 'stageRecovery', queued: 'stageQueued' };
function bytes(value: number): string {
  const units = [MESSAGES.byteUnit, MESSAGES.kilobyteUnit, MESSAGES.megabyteUnit, MESSAGES.gigabyteUnit]; let unit = 0; let number = value;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit++; }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number)} ${units[unit]}`;
}
function terminal(snapshot: TaskSnapshot): boolean { return ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(snapshot.state); }

function InstallTask({ initial, onSettled }: { initial: TaskSnapshot; onSettled: (snapshot: TaskSnapshot) => void }) {
  const [snapshot, setSnapshot] = useState(initial); const [error, setError] = useState<MessageKey>(); const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    if (!window.oucl) return; let active = true; let dispose: (() => void) | undefined; let timer: ReturnType<typeof setInterval> | undefined;
    const bridge = window.oucl;
    void bridge.subscribeTask(initial.taskId, value => { if (active) setSnapshot(value); }).then(subscription => {
      if (!active) { subscription.dispose(); return; }
      dispose = subscription.dispose;
      if (!subscription.result.ok) {
        timer = setInterval(() => { void bridge.getTask(initial.taskId).then(result => { if (active && result.ok) setSnapshot(result.data.snapshot); }); }, 1000);
        setError(subscription.result.error.messageKey);
      }
    }).catch(() => { if (active) setError('unavailable'); });
    return () => { active = false; dispose?.(); clearInterval(timer); };
  }, [initial.taskId]);
  useEffect(() => { if (terminal(snapshot)) onSettled(snapshot); }, [snapshot.state, onSettled]);
  async function cancel(): Promise<void> {
    if (!window.oucl || cancelling) return; setCancelling(true); setError(undefined);
    const result = await window.oucl.controlTask(snapshot.taskId, 'cancel');
    if (!result.ok) { setError(result.error.messageKey); setCancelling(false); }
  }
  return <article className="install-task" data-task-id={snapshot.taskId} data-task-state={snapshot.state}>
    <div className="task-heading"><strong>{MESSAGES[STAGE_MESSAGES[snapshot.stage]]}</strong>
      {!terminal(snapshot) && <button disabled={cancelling || snapshot.state === 'committing' || snapshot.state === 'cancelling'} onClick={() => { void cancel(); }}>{MESSAGES.cancelTask}</button>}
    </div>
    {snapshot.bytesTotal !== undefined && <><progress max={snapshot.bytesTotal || 1} value={snapshot.bytesDone} /><p className="storage-note">{MESSAGES.preparedBytes} {bytes(snapshot.bytesDone)} / {bytes(snapshot.bytesTotal)}</p></>}
    {(cancelling || snapshot.state === 'cancelling') && !terminal(snapshot) && <p role="status">{MESSAGES.cancellingTask}</p>}
    {(error || snapshot.error) && <p role="alert" className="form-error">{MESSAGES[error ?? snapshot.error!.messageKey]}</p>}
  </article>;
}

/** Connects the approved vanilla instance/task flow; all network, files and process work stays behind preload. */
export function InstallPanel({ enabled, rootId, versionId }: { enabled: boolean; rootId: string | undefined; versionId: string | undefined }) {
  const [displayName, setDisplayName] = useState(''); const [isolation, setIsolation] = useState<'on' | 'off'>('on');
  const [instances, setInstances] = useState<InstanceSummary[]>([]); const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<MessageKey>(); const [refresh, setRefresh] = useState(0);
  const requestId = useRef<string | undefined>(undefined); const accepted = useRef(false);
  const refreshList = useCallback(() => { setRefresh(value => value + 1); }, []);
  const taskSettled = useCallback((snapshot: TaskSnapshot) => {
    if (snapshot.state === 'failed' || snapshot.state === 'cancelled') { accepted.current = false; requestId.current = undefined; }
    refreshList();
  }, [refreshList]);
  useEffect(() => { setDisplayName(versionId ?? ''); requestId.current = undefined; accepted.current = false; setError(undefined); }, [versionId]);
  useEffect(() => {
    if (!enabled || !rootId || !window.oucl) return; let active = true;
    void Promise.all([window.oucl.listInstances({ rootId, limit: 100 }), window.oucl.listTasks({ limit: 100 })]).then(([listed, current]) => {
      if (!active) return;
      if (listed.ok) setInstances(listed.data.items); else setError(listed.error.messageKey);
      if (current.ok) setTasks(current.data.items.slice(-6)); else setError(current.error.messageKey);
    }).catch(() => { if (active) setError('unavailable'); });
    return () => { active = false; };
  }, [enabled, rootId, refresh]);
  async function install(): Promise<void> {
    if (!window.oucl || !rootId || !versionId || busy || accepted.current) return;
    setBusy(true); setError(undefined); requestId.current ??= crypto.randomUUID();
    try {
      const result = await window.oucl.createInstance(requestId.current, { rootId, mcVersionId: versionId, displayName: displayName.trim(), isolation });
      if (!result.ok) { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') requestId.current = undefined; return; }
      accepted.current = true; const task = await window.oucl.getTask(result.data.taskId);
      if (task.ok) setTasks(current => [...current.filter(item => item.taskId !== result.data.taskId), task.data.snapshot].slice(-6));
      refreshList();
    } catch { setError('unavailable'); } finally { setBusy(false); }
  }
  if (!enabled) return null;
  return <div className="installation-column">
    <section className="card install-confirm" aria-labelledby="install-title"><h2 id="install-title">{MESSAGES.installTitle}</h2>
      {!versionId ? <p>{MESSAGES.installPrompt}</p> : <><div className="selected-version">{versionId}</div>
        <label>{MESSAGES.instanceName}<input value={displayName} maxLength={80} onChange={event => { setDisplayName(event.target.value); requestId.current = undefined; accepted.current = false; }} /></label>
        <select aria-label={MESSAGES.isolationOn} value={isolation} onChange={event => { setIsolation(event.target.value as 'on' | 'off'); requestId.current = undefined; accepted.current = false; }}><option value="on">{MESSAGES.isolationOn}</option><option value="off">{MESSAGES.isolationOff}</option></select>
        <p className="storage-note">{MESSAGES.installHint}</p>
        {!rootId && <p>{MESSAGES.chooseRootFirst}</p>}
        <button className="primary" disabled={busy || !rootId || displayName.trim().length === 0 || accepted.current} onClick={() => { void install(); }}>{busy ? MESSAGES.installAccepting : MESSAGES.installConfirm}</button>
      </>}
      {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
    </section>
    {tasks.length > 0 && <section className="card"><h2>{MESSAGES.tasksTitle}</h2>{tasks.map(task => <InstallTask key={task.taskId} initial={task} onSettled={taskSettled} />)}</section>}
    <section className="card"><div className="task-heading"><h2>{MESSAGES.installedTitle}</h2><button disabled={!rootId} onClick={refreshList}>{MESSAGES.refreshInstances}</button></div>
      {instances.length === 0 ? <p>{MESSAGES.noInstances}</p> : <ul className="instance-list">{instances.map(instance => <li key={instance.instanceId} data-instance-id={instance.instanceId} data-instance-state={instance.state}><div><strong>{instance.displayName}</strong><span>{instance.mcVersionId}</span></div><span>{instance.state === 'ready' ? MESSAGES.stateReady : instance.state === 'installing' ? MESSAGES.stateInstalling : instance.state === 'needsRecovery' ? MESSAGES.stageRecovery : instance.state === 'cancelled' ? MESSAGES.stageCancelled : MESSAGES.stageFailed}</span></li>)}</ul>}
    </section>
  </div>;
}
