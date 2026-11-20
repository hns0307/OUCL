import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { InstanceSummary } from '../shared/contracts/instances.js';
import type { WebAction, WebBounds, WebErrorCode, WebSnapshot } from '../shared/contracts/web-extensions.js';
import { MAX_WEB_TABS } from '../shared/contracts/web-extensions.js';
import { WEB_DOWNLOAD_STATE, WEB_ERRORS_TEXT, WEB_FILE_KIND, WEB_TEXT } from '../shared/locales/web-extensions.js';
import './web-extensions.css';

function volume(bytes: number): string { return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }

/** Local launcher controls. The actual site runs in a main-owned Chromium view. */
export function WebExtensions({ enabled, instances, onSkinDraft }: {
  enabled: boolean; instances: readonly InstanceSummary[]; onSkinDraft?: (png: Uint8Array) => void;
}) {
  const [data, setData] = useState<WebSnapshot>();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<WebErrorCode>();
  const [instanceId, setInstanceId] = useState('');
  const [packNames, setPackNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const live = useRef(false);
  const running = useRef(false);
  const active = data?.tabs.find(tab => tab.id === data.activeId);
  const targets = instances.filter(instance => instance.state === 'ready' && instance.isolation !== 'off');
  const target = targets.find(instance => instance.instanceId === instanceId);
  const accept = useCallback((incoming: WebSnapshot) => {
    const snapshot = { ...incoming };
    delete snapshot.skinDraft;
    setData(previous => previous && previous.revision > snapshot.revision ? previous : snapshot);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    const bridge = window.oucl;
    let pending = false;
    let mounted = true;
    const read = async (): Promise<void> => {
      if (!bridge || !mounted || pending || document.hidden) return;
      pending = true;
      try {
        const result = await bridge.webExtensions({ kind: 'state' });
        if (mounted && result.ok) accept(result.data);
      } finally { pending = false; }
    };
    void read();
    const polling = setInterval(() => { void read(); }, 700);
    return () => {
      live.current = false; mounted = false;
      clearInterval(polling);
    };
  }, [accept, enabled]);

  useLayoutEffect(() => {
    if (!enabled || !slot.current || !panel.current) return;
    const bridge = window.oucl;
    const element = slot.current;
    let last = '';
    let frame = 0;
    const measure = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = element.getBoundingClientRect();
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const x = Math.ceil(rect.left); const y = Math.ceil(rect.top);
        const width = Math.floor(right - x); const height = Math.floor(bottom - y);
        const bounds: WebBounds | null = document.hidden || x < 0 || y < 80 || width < 120 || height < 120 ? null : { x, y, width, height };
        const value = JSON.stringify(bounds);
        if (last === value) return;
        last = value;
        void bridge?.webExtensions({ kind: 'layout', bounds });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel.current); observer.observe(element); observer.observe(document.body);
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true);
    document.addEventListener('visibilitychange', measure);
    measure();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', measure);
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true);
      window.cancelAnimationFrame(frame);
      void bridge?.webExtensions({ kind: 'deactivate' });
    };
  }, [enabled]);

  useEffect(() => { setAddress(active?.url ?? ''); }, [active?.id, active?.url]);

  async function run(action: WebAction): Promise<void> {
    const bridge = window.oucl;
    if (!bridge || running.current) return;
    running.current = true; setBusy(true); setError(undefined);
    try {
      const result = await bridge.webExtensions(action);
      if (!live.current) return;
      if (!result.ok) setError(result.error);
      else {
        accept(result.data);
        if (action.kind === 'skinDraft' && result.data.skinDraft) onSkinDraft?.(result.data.skinDraft);
      }
    } catch { if (live.current) setError('UNAVAILABLE'); }
    finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  }

  function navigate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const url = address.trim();
    if (url) void run(active ? { kind: 'navigate', tabId: active.id, url } : { kind: 'open', url });
  }

  return <section className="panel web-extensions" aria-label={WEB_TEXT.title} ref={panel}>
    <div className="web-tabs" role="group" aria-label={WEB_TEXT.tabs}>
      {data?.tabs.map(tab => <span className="web-tab" key={tab.id}>
        <button type="button" className="secondary" aria-pressed={active?.id === tab.id} onClick={() => { void run({ kind: 'select', tabId: tab.id }); }}>
          {tab.icon ? <img alt="" width="16" height="16" src={tab.icon} /> : <span className="web-tab-icon" aria-hidden="true">{tab.title[0]?.toUpperCase() || '·'}</span>}
          <span>{tab.title || WEB_TEXT.untitled}</span>
        </button>
        <button type="button" className="secondary web-tab-close" aria-label={WEB_TEXT.closeTab} onClick={() => { void run({ kind: 'closeTab', tabId: tab.id }); }}>×</button>
      </span>)}
      <button type="button" className="secondary" disabled={!enabled || busy || (data?.tabs.length ?? 0) >= MAX_WEB_TABS}
        aria-label={WEB_TEXT.newTab} onClick={() => { void run({ kind: 'newTab' }); }}>＋</button>
    </div>
    <form className="web-address" onSubmit={navigate}>
      <button type="button" className="secondary" aria-label={WEB_TEXT.back} disabled={!active?.canBack}
        onClick={() => { if (active) void run({ kind: 'back', tabId: active.id }); }}>←</button>
      <button type="button" className="secondary" aria-label={WEB_TEXT.forward} disabled={!active?.canForward}
        onClick={() => { if (active) void run({ kind: 'forward', tabId: active.id }); }}>→</button>
      <button type="button" className="secondary" aria-label={WEB_TEXT.refresh} disabled={!active?.url}
        onClick={() => { if (active) void run({ kind: 'reload', tabId: active.id }); }}>↻</button>
      <input aria-label={WEB_TEXT.address} placeholder={WEB_TEXT.placeholder} value={address} maxLength={4096}
        onChange={event => { setAddress(event.currentTarget.value); }} inputMode="url" spellCheck={false} disabled={!enabled} />
      <button type="submit" disabled={!enabled || busy || !address.trim()}>{WEB_TEXT.go}</button>
    </form>
    <div className="web-controls">
      {active?.url && <>
        <button type="button" className="secondary" onClick={() => { void run({ kind: 'bookmark', tabId: active.id }); }}>☆ {WEB_TEXT.bookmark}</button>
        <button type="button" className="secondary" onClick={() => { void run({ kind: 'external', tabId: active.id }); }}>{WEB_TEXT.external}</button>
        <button type="button" className="secondary" aria-label={WEB_TEXT.zoomOut} disabled={active.zoom <= .5}
          onClick={() => { void run({ kind: 'zoom', tabId: active.id, factor: Math.max(.5, active.zoom - .1) }); }}>−</button>
        <span>{Math.round(active.zoom * 100)}%</span>
        <button type="button" className="secondary" aria-label={WEB_TEXT.zoomIn} disabled={active.zoom >= 2}
          onClick={() => { void run({ kind: 'zoom', tabId: active.id, factor: Math.min(2, active.zoom + .1) }); }}>＋</button>
      </>}
      <button type="button" className="secondary" disabled={!enabled || busy} onClick={() => { void run({ kind: 'clearSession' }); }}>{WEB_TEXT.clear}</button>
    </div>
    {data?.popup && <div className="web-controls" role="status">
      <span>{WEB_TEXT.popup} {data.popup.origin}</span>
      <button type="button" disabled={busy} onClick={() => { void run({ kind: 'acceptPopup', popupId: data.popup!.id }); }}>{WEB_TEXT.acceptPopup}</button>
      <button type="button" className="secondary" onClick={() => { void run({ kind: 'dismissPopup', popupId: data.popup!.id }); }}>{WEB_TEXT.cancel}</button>
    </div>}
    {error && <p role="alert" className="form-error">{WEB_ERRORS_TEXT[error]}</p>}
    {data?.bookmarks.length ? <details className="web-library">
      <summary>{WEB_TEXT.bookmarks} · {data.bookmarks.length}</summary>
      <ul>{data.bookmarks.map(item => <li key={item.id}>
        <button type="button" className="secondary" onClick={() => { void run({ kind: 'openBookmark', bookmarkId: item.id }); }}>{item.title || item.url}</button>
        <button type="button" className="secondary" onClick={() => { void run({ kind: 'removeBookmark', bookmarkId: item.id }); }}>{WEB_TEXT.remove}</button>
      </li>)}</ul>
    </details> : null}
    {data?.downloads.length ? <details className="web-library" open={data.downloads.some(item => item.status === 'confirmation') || undefined}>
      <summary>{WEB_TEXT.downloads} · {data.downloads.length}</summary>
      <ul>{data.downloads.map(item => <li key={item.id}>
        <div><strong>{item.filename}</strong> · {WEB_FILE_KIND[item.fileKind]} · {WEB_DOWNLOAD_STATE[item.status]}</div>
        <small>{item.origin}{item.receivedBytes > 0 && ` · ${volume(item.receivedBytes)}`}{item.totalBytes !== null && ` / ${volume(item.totalBytes)}`}</small>
        {item.note && <p role="status">{WEB_TEXT[item.note]}</p>}
        {item.status === 'ready' && item.packPreview && <>
          <p>{item.packPreview.name} · Minecraft {item.packPreview.minecraft} · {item.packPreview.loader}</p>
          <p>{WEB_TEXT.packFiles} {item.packPreview.required} · {WEB_TEXT.packOptional} {item.packPreview.optional} · {WEB_TEXT.packOverrides} {item.packPreview.overrides}</p>
          {data.packImport && !item.packTaskId ? <div className="web-controls">
            <input aria-label={WEB_TEXT.packName} maxLength={80} value={packNames[item.id] ?? item.packPreview.name}
              onChange={event => { const name = event.currentTarget.value; setPackNames(values => ({ ...values, [item.id]: name })); }} />
            <button type="button" disabled={busy || !(packNames[item.id] ?? item.packPreview.name).trim()} onClick={() => {
              const name = (packNames[item.id] ?? item.packPreview!.name).trim();
              void run({ kind: 'installPack', downloadId: item.id, name });
            }}>{WEB_TEXT.installPack}</button>
          </div> : !data.packImport ? <p>{WEB_TEXT.packExport}</p> : null}
        </>}
        <div className="web-controls">
          {item.status === 'confirmation' && <button type="button" disabled={busy} onClick={() => { void run({ kind: 'download', downloadId: item.id }); }}>{WEB_TEXT.confirmDownload}</button>}
          {(item.status === 'confirmation' || item.status === 'downloading') && <button type="button" className="secondary"
            onClick={() => { void run({ kind: 'cancelDownload', downloadId: item.id }); }}>{WEB_TEXT.cancel}</button>}
          {item.status === 'ready' && <button type="button" className="secondary"
            onClick={() => { void run({ kind: 'exportDownload', downloadId: item.id }); }}>{WEB_TEXT.export}</button>}
          {item.status === 'ready' && item.fileKind === 'mod' && !item.note && <button type="button" disabled={busy}
            onClick={() => { void run({ kind: 'prepareMod', downloadId: item.id }); }}>{WEB_TEXT.prepareMod}</button>}
          {item.status === 'ready' && item.fileKind === 'skin' && onSkinDraft && <button type="button" disabled={busy}
            onClick={() => { void run({ kind: 'skinDraft', downloadId: item.id }); }}>{WEB_TEXT.skin}</button>}
          {item.status === 'ready' && (item.fileKind === 'shader' || item.fileKind === 'resourcepack') && !item.note && <>
            <select aria-label={WEB_TEXT.root} value={instanceId} onChange={event => { setInstanceId(event.currentTarget.value); }}>
              <option value="">{WEB_TEXT.root}</option>{targets.map(instance => <option key={instance.instanceId}
                value={instance.instanceId}>{instance.displayName}</option>)}
            </select>
            <button type="button" disabled={busy || !target} onClick={() => {
              if (target) void run({ kind: 'importAddon', downloadId: item.id, instanceId: target.instanceId, revision: target.revision });
            }}>{WEB_TEXT.import}</button>
          </>}
          {['ready', 'failed', 'cancelled'].includes(item.status) && <button type="button" className="secondary"
            onClick={() => { void run({ kind: 'removeDownload', downloadId: item.id }); }}>{WEB_TEXT.remove}</button>}
        </div>
      </li>)}</ul>
    </details> : null}
    <div className="web-viewport" ref={slot} aria-live="polite">
      <p>{!enabled ? WEB_TEXT.unavailable : active?.status === 'failed' ? WEB_TEXT.loadFailed
        : active?.status === 'loading' ? WEB_TEXT.layoutWait : active?.status === 'ready' ? null : WEB_TEXT.empty}</p>
    </div>
  </section>;
}
