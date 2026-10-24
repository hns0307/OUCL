import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { RootSummary } from '../shared/contracts/roots.js';

/** Presents the native-directory workflow using only the narrow preload API. */
export function RootSettings({ enabled }: { enabled: boolean }) {
  const [items, setItems] = useState<RootSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MessageKey>();
  const retryId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let active = true;
    void window.oucl?.listRoots().then(result => {
      if (!active) return;
      if (result.ok) { setItems(result.data.items); setError(undefined); } else setError(result.error.messageKey);
      setLoading(false);
    }).catch(() => { if (active) { setError('rootsUnavailable'); setLoading(false); } });
    return () => { active = false; };
  }, [enabled]);
  async function choose(): Promise<void> {
    const bridge = window.oucl; if (!bridge || busy) return;
    setBusy(true); setError(undefined); retryId.current ??= crypto.randomUUID();
    try {
      const result = await bridge.chooseRoot(retryId.current);
      if (!result.ok) { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') retryId.current = undefined; return; }
      retryId.current = undefined;
      const listed = await bridge.listRoots();
      if (listed.ok) setItems(listed.data.items); else setError(listed.error.messageKey);
    } catch { setError('rootsUnavailable'); }
    finally { setBusy(false); }
  }
  async function refresh(): Promise<void> {
    if (!window.oucl || busy) return; setBusy(true);
    try { const result = await window.oucl.listRoots(); if (result.ok) { setItems(result.data.items); setError(undefined); } else setError(result.error.messageKey); }
    catch { setError('rootsUnavailable'); } finally { setBusy(false); }
  }
  return <section className="root-settings card" aria-labelledby="storage-title">
    <div className="root-content"><h2 id="storage-title">{MESSAGES.storageTitle}</h2><p>{MESSAGES.storageDescription}</p>
      {!enabled ? <p role="status">{MESSAGES.rootsUnavailable}</p> : loading ? <p role="status">{MESSAGES.rootsLoading}</p>
        : items.length === 0 ? <button disabled={busy} onClick={() => { void choose(); }}>{busy ? MESSAGES.choosingStorage : MESSAGES.chooseStorage}</button>
          : items.map(item => <div className="registered-root" key={item.rootId}><strong>{item.label}</strong><span>{item.available ? MESSAGES.rootReady : MESSAGES.rootUnavailable}</span>
            {!item.available && <button disabled={busy} onClick={() => { void refresh(); }}>{MESSAGES.refreshRoots}</button>}</div>)}
      <p className="storage-note">{MESSAGES.fixedStorage}</p>
      {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
    </div>
  </section>;
}
