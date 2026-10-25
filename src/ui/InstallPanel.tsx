import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { InstallStage, TaskSnapshot } from '../shared/contracts/instances.js';
import { useLauncher } from './launcher-state.js';

const STAGE_MESSAGES: Record<InstallStage, MessageKey> = { metadata: 'stageMetadata', downloading: 'stageDownloading', materializing: 'stageMaterializing',
  committing: 'stageCommitting', completed: 'stageCompleted', failed: 'stageFailed', cancelled: 'stageCancelled', needsRecovery: 'stageRecovery', queued: 'stageQueued', preparing: 'stagePreparing' };
function bytes(value: number): string {
  const units = [MESSAGES.byteUnit, MESSAGES.kilobyteUnit, MESSAGES.megabyteUnit, MESSAGES.gigabyteUnit]; let unit = 0; let number = value;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit++; }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number)} ${units[unit]}`;
}
function terminal(snapshot: TaskSnapshot): boolean { return ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(snapshot.state); }

export function InstallTask({ initial, onSettled }: { initial: TaskSnapshot; onSettled: (snapshot: TaskSnapshot) => void }) {
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
  const { settings, tasks, refreshGame } = useLauncher();
  const [displayName, setDisplayName] = useState(''); const [isolation, setIsolation] = useState<'on' | 'off'>('on');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<MessageKey>();
  const requestId = useRef<string | undefined>(undefined); const accepted = useRef(false);
  useEffect(() => { setDisplayName(versionId ?? ''); requestId.current = undefined; accepted.current = false; setError(undefined); }, [versionId]);
  useEffect(() => { setIsolation(settings?.isolationDefault === false ? 'off' : 'on'); }, [versionId, settings?.isolationDefault]);
  async function install(): Promise<void> {
    if (!window.oucl || !rootId || !versionId || busy || accepted.current) return;
    setBusy(true); setError(undefined); requestId.current ??= crypto.randomUUID();
    try {
      const result = await window.oucl.createInstance(requestId.current, { rootId, mcVersionId: versionId, displayName: displayName.trim(), isolation });
      if (!result.ok) { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') requestId.current = undefined; return; }
      accepted.current = true; await refreshGame();
    } catch { setError('unavailable'); } finally { setBusy(false); }
  }
  if (!enabled) return null;
  return <div className="installation-column"><section className="card install-confirm" aria-labelledby="install-title"><h2 id="install-title">{MESSAGES.installTitle}</h2>
    {!versionId ? <div className="empty-state"><span className="empty-glyph">↓</span><p>{MESSAGES.installPrompt}</p></div> : <><div className="selected-version">{versionId}</div>
      <label>{MESSAGES.instanceName}<input value={displayName} maxLength={80} onChange={event => { setDisplayName(event.target.value); requestId.current = undefined; accepted.current = false; }} /></label>
      <select aria-label={MESSAGES.isolationOn} value={isolation} onChange={event => { setIsolation(event.target.value as 'on' | 'off'); requestId.current = undefined; accepted.current = false; }}><option value="on">{MESSAGES.isolationOn}</option><option value="off">{MESSAGES.isolationOff}</option></select>
      <p className="storage-note">{MESSAGES.installHint}</p>{!rootId && <p>{MESSAGES.chooseRootFirst}</p>}
      <button className="primary" disabled={busy || !rootId || !displayName.trim() || accepted.current} onClick={() => { void install(); }}>{busy ? MESSAGES.installAccepting : MESSAGES.installConfirm}</button>
    </>}{error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}</section>
    {tasks.some(t => t.kind === 'install') && <section className="card"><h2>{MESSAGES.tasksTitle}</h2>{tasks.filter(t => t.kind === 'install').slice(-6).map(task => <InstallTask key={task.taskId} initial={task} onSettled={refreshGame} />)}</section>}
  </div>;
}
