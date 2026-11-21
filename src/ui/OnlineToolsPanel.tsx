import { useEffect, useRef, useState } from 'react';
import type { OnlineToolsData, OnlineToolsResult } from '../shared/contracts/online-tools.js';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';

const PHASES = { closed: 'onlineToolsClosed', loading: 'onlineToolsLoading', ready: 'onlineToolsReady', failed: 'onlineToolsFailed', closing: 'onlineToolsClosing' } as const;
/** Polling is single-flight and scoped to this visible page. Unmount closes the main-owned remote view. */
export function OnlineToolsPanel({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<OnlineToolsData>(); const [error, setError] = useState<MessageKey>(); const [busy, setBusy] = useState(false);
  const alive = useRef(false); const generation = useRef(0);
  useEffect(() => {
    alive.current = true; const bridge = window.oucl; let querying = false; let active = true;
    async function refresh(): Promise<void> {
      if (!enabled || !bridge || querying || document.hidden) return; querying = true;
      try { const result = await bridge.onlineToolState(); if (active) {
        if (result.ok) { setData(previous => !previous || result.data.snapshot.revision >= previous.snapshot.revision ? result.data : previous); }
        else setError(result.error.messageKey);
      } } catch { if (active) setError('unavailable'); } finally { querying = false; }
    }
    void refresh(); const timer = setInterval(() => { void refresh(); }, 1500);
    return () => { active = false; alive.current = false; generation.current++; clearInterval(timer); if (enabled && bridge) void bridge.closeOnlineTool(crypto.randomUUID()).catch(() => {}); };
  }, [enabled]);
  async function run(action: () => Promise<OnlineToolsResult>, interrupt = false): Promise<void> {
    if (busy && !interrupt) return; const ticket = ++generation.current; setBusy(true); setError(undefined);
    try { const result = await action(); if (alive.current && ticket === generation.current) {
      if (result.ok) setData(previous => !previous || result.data.snapshot.revision >= previous.snapshot.revision ? result.data : previous);
      else setError(result.error.messageKey);
    } } catch { if (alive.current && ticket === generation.current) setError('unavailable'); }
    finally { if (alive.current && ticket === generation.current) setBusy(false); }
  }
  const attached = data && data.snapshot.phase !== 'closed';
  return <section className={`panel online-tools-panel${attached ? ' online-tools-attached' : ''}`} aria-label={MESSAGES.onlineToolsTitle}>
    <div className="online-tools-controls"><h2>{MESSAGES.onlineToolsTitle}</h2><p>{MESSAGES.onlineToolsHint}</p>
      {!enabled ? <p role="status">{MESSAGES.unavailable}</p> : data?.tools.length === 0 ? <p role="status">{MESSAGES.onlineToolsUnconfigured}</p> : !data ? <p role="status">{MESSAGES.connecting}</p> : <div className="save-row">{data.tools.map(tool => <button key={tool.toolId} disabled={busy} onClick={() => { void run(() => window.oucl!.openOnlineTool(crypto.randomUUID(), tool.toolId)); }}>{MESSAGES.onlineToolsOpen} · {tool.title}</button>)}</div>}
      {data && <p role="status">{MESSAGES.onlineToolsState}：{MESSAGES[PHASES[data.snapshot.phase]]}{data.snapshot.toolId && <> · {data.tools.find(tool => tool.toolId === data.snapshot.toolId)?.title}</>}</p>}
      {attached && <div className="save-row"><button disabled={busy || data.snapshot.phase === 'closing'} onClick={() => { void run(() => window.oucl!.retryOnlineTool(crypto.randomUUID())); }}>{MESSAGES.onlineToolsRetry}</button>
        <button className="secondary" onClick={() => { void run(() => window.oucl!.closeOnlineTool(crypto.randomUUID()), true); }}>{MESSAGES.onlineToolsClose}</button></div>}
      {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
    </div>
  </section>;
}
