import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { SessionSnapshot } from '../shared/contracts/game.js';
import type { InstanceSummary, TaskSnapshot } from '../shared/contracts/instances.js';

/** Queries current owned sessions at a bounded cadence; it never treats a task's acceptance as a running game. */
export function useGameSessions(enabled: boolean, rootId: string | undefined): SessionSnapshot[] {
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  useEffect(() => {
    if (!enabled || !rootId || !window.oucl) return; let active = true; let querying = false; const bridge = window.oucl;
    const refresh = async (): Promise<void> => {
      if (querying) return; querying = true;
      try { const result = await bridge.listSessions({ limit: 100 }); if (active && result.ok) setSessions(result.data.items); } finally { querying = false; }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [enabled, rootId]); return sessions;
}
/** Uses existing task subscriptions for preparation, then real session facts for running/exit and explicit stop confirmation. */
export function LaunchControls({ instance, accountId, current }: { instance: InstanceSummary; accountId: string | undefined; current: SessionSnapshot | undefined }) {
  const [pending, setPending] = useState(false); const [taskId, setTaskId] = useState<string>(); const [error, setError] = useState<MessageKey>();
  const [local, setLocal] = useState<SessionSnapshot>(); const [confirmed, setConfirmed] = useState(false);
  const launchId = useRef<string | undefined>(undefined); const stopId = useRef<string | undefined>(undefined);
  const session = local && (!current || local.startedAt > current.startedAt || local.sessionId === current.sessionId && local.revision > current.revision) ? local : current;
  const busy = Boolean(session && session.state !== 'exited');
  useEffect(() => { setConfirmed(false); }, [session?.sessionId]);
  useEffect(() => {
    if (!taskId || !window.oucl) return; let active = true; let done = false; let dispose: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined; let querying = false; const bridge = window.oucl;
    const receive = (snapshot: TaskSnapshot): void => {
      if (!active || done || !['completed', 'failed', 'cancelled', 'needsRecovery'].includes(snapshot.state)) return;
      done = true; dispose?.(); clearInterval(timer);
      void (async () => {
        const result = await bridge.getTask(taskId);
        if (result.ok && result.data.result && 'sessionId' in result.data.result) { const state = await bridge.getSession(result.data.result.sessionId); if (active && state.ok) setLocal(state.data); }
        if (active) { setError(snapshot.error?.messageKey ?? (snapshot.state === 'cancelled' ? 'stageCancelled' : undefined)); setPending(false); launchId.current = undefined; stopId.current = undefined; }
      })().catch(() => { if (active) { setPending(false); setError('unavailable'); } });
    };
    void bridge.subscribeTask(taskId, receive).then(subscription => {
      if (!active || done) { subscription.dispose(); return; } dispose = subscription.dispose;
      if (subscription.result.ok) receive(subscription.result.data.snapshot);
      else timer = setInterval(() => { if (querying) return; querying = true; void bridge.getTask(taskId).then(result => { if (result.ok) receive(result.data.snapshot); }).finally(() => { querying = false; }); }, 1000);
    }).catch(() => { if (active) { setError('unavailable'); setPending(false); } });
    return () => { active = false; dispose?.(); clearInterval(timer); };
  }, [taskId]);
  async function launch(): Promise<void> {
    if (!window.oucl || !accountId || pending || busy) return; setPending(true); setError(undefined); launchId.current ??= crypto.randomUUID();
    try { const result = await window.oucl.launchGame(launchId.current, { instanceId: instance.instanceId, accountId, expectedRevision: instance.revision });
      if (result.ok) setTaskId(result.data.taskId); else { setPending(false); setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') launchId.current = undefined; }
    } catch { setPending(false); setError('unavailable'); }
  }
  async function stop(): Promise<void> {
    if (!window.oucl || !session || !confirmed || pending) return; setPending(true); setError(undefined); stopId.current ??= crypto.randomUUID();
    try { const result = await window.oucl.stopGame(stopId.current, { sessionId: session.sessionId, mode: 'force', confirmed });
      if (result.ok) { setTaskId(result.data.taskId); setConfirmed(false); } else { setPending(false); setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') stopId.current = undefined; }
    } catch { setPending(false); setError('unavailable'); }
  }
  return <div className="launch-controls" data-game-state={session?.state ?? 'idle'}>
    <button className="primary" disabled={pending || busy || !accountId} onClick={() => { void launch(); }}>{pending ? MESSAGES.launchPreparing : session?.state === 'running' ? MESSAGES.gameRunning : MESSAGES.launchGame}</button>
    {!accountId && <span className="storage-note">{MESSAGES.chooseAccountFirst}</span>}
    {session && <p role="status">{session.state === 'running' ? MESSAGES.gameRunning : session.state === 'stopping' ? MESSAGES.gameStopping : session.state === 'unknown' ? MESSAGES.gameUnknown : `${MESSAGES.gameExited}${session.exitCode === undefined ? '' : ` · ${MESSAGES.exitCode} ${session.exitCode}`}`}</p>}
    {session?.state === 'running' && <><p className="storage-note">{MESSAGES.gameKeepAlive}</p><label className="force-confirm"><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); }} />{MESSAGES.confirmForceStop}</label><button disabled={!confirmed || pending} onClick={() => { void stop(); }}>{MESSAGES.forceStop}</button></>}
    {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
  </div>;
}
