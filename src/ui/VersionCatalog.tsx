import { useEffect, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { CatalogData, CatalogQuery } from '../shared/contracts/catalog.js';

/** Browses the actual official catalog without implying that installation is already available. */
export function VersionCatalog({ enabled }: { enabled: boolean }) {
  const [channel, setChannel] = useState<CatalogQuery['channel']>('release');
  const [data, setData] = useState<CatalogData>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<MessageKey>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled || !window.oucl) return;
    let active = true; setBusy(true); setError(undefined);
    void window.oucl.catalog({ channel, limit: 20 }).then(result => {
      if (!active) return;
      if (result.ok) setData(result.data); else { setError(result.error.messageKey); setData(undefined); }
    }).catch(() => { if (active) setError('catalogUnavailable'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [enabled, channel, refresh]);
  async function next(): Promise<void> {
    if (!window.oucl || !data?.page.nextCursor || busy) return;
    setBusy(true); setError(undefined);
    try {
      const result = await window.oucl.catalog({ channel, limit: 20, cursor: data.page.nextCursor });
      if (result.ok) setData(result.data); else setError(result.error.messageKey);
    } catch { setError('catalogUnavailable'); } finally { setBusy(false); }
  }
  if (!enabled) return null;
  return <section className="card catalog" aria-labelledby="catalog-title"><div className="root-content">
    <h2 id="catalog-title">{MESSAGES.catalogTitle}</h2><p>{MESSAGES.catalogDescription}</p>
    <div className="catalog-toolbar"><select aria-label={MESSAGES.catalogTitle} value={channel} disabled={busy} onChange={event => { setChannel(event.target.value as CatalogQuery['channel']); }}>
      <option value="release">{MESSAGES.catalogRelease}</option><option value="snapshot">{MESSAGES.catalogSnapshot}</option><option value="old">{MESSAGES.catalogOld}</option>
    </select><button disabled={busy} onClick={() => { setRefresh(value => value + 1); }}>{MESSAGES.catalogRefresh}</button></div>
    {busy && <p role="status">{MESSAGES.catalogLoading}</p>}
    {error && <p role="alert" className="form-error">{MESSAGES[error]}</p>}
    {data && <><p className="storage-note">{data.cached ? MESSAGES.catalogCached : MESSAGES.catalogFresh} · {new Date(data.fetchedAt).toLocaleString()}</p>
      <ul className="version-list">{data.page.items.map(item => <li key={item.mcVersionId}><strong>{item.mcVersionId}</strong><time dateTime={item.releaseTime}>{new Date(item.releaseTime).toLocaleDateString()}</time></li>)}</ul>
      {data.page.nextCursor && <button disabled={busy} onClick={() => { void next(); }}>{MESSAGES.catalogMore}</button>}
      <p className="storage-note">{MESSAGES.catalogCandidate}</p></>}
  </div></section>;
}
