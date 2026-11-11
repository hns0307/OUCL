import { ResourceIcon } from './ResourceIcon.js';
import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { LibraryItem, ResourceKind, ResourceProject, ResourceVersion } from '../shared/contracts/resources.js';
import type { InstanceSummary } from '../shared/contracts/instances.js';
import type { ModInstallPlan } from '../shared/contracts/mods.js';
import { resourceFailure } from '../shared/contracts/resources.js';
import { useLauncher } from './launcher-state.js';
import { InstallTask } from './InstallPanel.js';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { ModInstallConfirmation } from './ModInstallConfirmation.js';

const size = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
function rememberPlan(key: string, requestId?: string): void {
  try { if (requestId) localStorage.setItem(key, requestId); else localStorage.removeItem(key); } catch { /* Browser storage is optional; the durable plan remains in the main process. */ }
}
/** Verified library downloads and explicit, durable Mod installation plans for the selected instance. */
export function ResourceBrowser({ enabled, kind, libraryOnly, modPlansEnabled, instance }: {
  enabled: boolean; kind: ResourceKind; libraryOnly: boolean; modPlansEnabled: boolean; instance?: InstanceSummary;
}) {
  const { rootId, tasks, refreshGame, queryTask, taskQueryErrors } = useLauncher();
  const [listWidth, setListWidth] = useState(60); const [dropHover, setDropHover] = useState(false);
  const resourceGrid = useRef<HTMLDivElement>(null);
  const draggedProject = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState(''); const [gameVersion, setGameVersion] = useState(''); const [loader, setLoader] = useState('');
  const [search, setSearch] = useState({ query: '', gameVersion: '', loader: '', offset: 0 }); const [refresh, setRefresh] = useState(0);
  const [projects, setProjects] = useState<ResourceProject[]>([]); const [total, setTotal] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const [selected, setSelected] = useState<ResourceProject>(); const [versions, setVersions] = useState<ResourceVersion[]>([]);
  const [versionId, setVersionId] = useState(''); const [fileId, setFileId] = useState(''); const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [busy, setBusy] = useState(false); const [versionBusy, setVersionBusy] = useState(false); const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<MessageKey>(); const [libraryError, setLibraryError] = useState<MessageKey>();
  const [plan, setPlan] = useState<ModInstallPlan>(); const [planning, setPlanning] = useState<string>(); const [planError, setPlanError] = useState<MessageKey>();
  const [planRequestId, setPlanRequestId] = useState<string>(); const [planCancelled, setPlanCancelled] = useState(false); const [cancelling, setCancelling] = useState(false);
  const [installationAccepted, setInstallationAccepted] = useState(false);
  const activePlanRequest = useRef<string | undefined>(undefined);
  const requests = useRef(new Map<string, string>());
  const planPointer = `oucl.mod-plan:${rootId}:${instance?.instanceId}`;
  useEffect(() => {
    setPlan(undefined); setPlanError(undefined); setPlanning(undefined); setPlanRequestId(undefined); setPlanCancelled(false); setCancelling(false);
    activePlanRequest.current = undefined; setInstallationAccepted(false);
    if (!rootId || !modPlansEnabled || !instance || instance.state !== 'ready' || !window.oucl) return;
    let requestId: string | null;
    try { requestId = localStorage.getItem(planPointer); } catch { return; }
    if (!requestId || !UUID_PATTERN.test(requestId)) return;
    let active = true; const selectedRequest = requestId; activePlanRequest.current = selectedRequest; setPlanning('restore');
    void window.oucl.getModPlan(selectedRequest).then(async result => {
      if (!active || activePlanRequest.current !== selectedRequest) return;
      if (result.ok) {
        if (result.data.status === 'cancelled') { rememberPlan(planPointer); return; }
        const installation = await window.oucl!.modInstallState(selectedRequest);
        if (!active || activePlanRequest.current !== selectedRequest) return;
        if (!installation.ok) { setPlanError(installation.error.messageKey); return; }
        setInstallationAccepted(installation.data.task !== null);
        if (result.data.plan.instanceId !== instance.instanceId || result.data.plan.instanceRevision !== instance.revision && !installation.data.task) {
          rememberPlan(planPointer); setPlanError('modsStale'); return;
        }
        setPlan(result.data.plan); setPlanRequestId(selectedRequest);
      } else { setPlanError(result.error.messageKey); if (result.error.code === 'NOT_FOUND') rememberPlan(planPointer); }
    }).catch(() => { if (active) setPlanError('unavailable'); }).finally(() => { if (active) setPlanning(undefined); });
    return () => { active = false; if (activePlanRequest.current === selectedRequest) activePlanRequest.current = undefined; };
  }, [instance?.instanceId, instance?.revision, instance?.state, modPlansEnabled, rootId, planPointer]);
  useEffect(() => { setSelected(undefined); setVersions([]); setVersionId(''); setFileId(''); }, [kind]);
  useEffect(() => {
    if (!enabled || libraryOnly || !window.oucl) return; let active = true; setBusy(true); setError(undefined); setSearchFailed(false);
    void window.oucl.searchResources({ ...search, kind }).then(result => {
      if (!active) return; if (result.ok) { setProjects(result.data.items); setTotal(result.data.total); } else { setProjects([]); setSearchFailed(true); setError(result.error.messageKey); }
    }).catch(() => { if (active) { setProjects([]); setSearchFailed(true); setError('resourceNetworkFailed'); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [enabled, libraryOnly, kind, search, refresh]);
  useEffect(() => {
    if (!enabled || !selected || !window.oucl) return; let active = true; setVersionBusy(true); setError(undefined); setVersions([]); setVersionId(''); setFileId('');
    void window.oucl.resourceVersions({ projectId: selected.projectId, gameVersion: search.gameVersion, loader: search.loader }).then(result => {
      if (!active) return; if (result.ok) { setVersions(result.data.items); const first = result.data.items[0]; setVersionId(first?.versionId ?? ''); setFileId(first?.files.find(f => f.primary)?.fileId ?? first?.files[0]?.fileId ?? ''); } else setError(result.error.messageKey);
    }).catch(() => { if (active) setError('resourceNetworkFailed'); }).finally(() => { if (active) setVersionBusy(false); });
    return () => { active = false; };
  }, [enabled, selected, search.gameVersion, search.loader, refresh]);
  useEffect(() => {
    if (!rootId || !window.oucl) return; let active = true; let querying = false;
    const load = async (): Promise<void> => {
      if (querying) return; querying = true;
      try { const result = await window.oucl!.resourceLibrary(); if (active) { if (result.ok) { setLibrary(result.data.items); setLibraryError(undefined); } else setLibraryError(result.error.messageKey); } }
      catch { if (active) setLibraryError('unavailable'); } finally { querying = false; }
    };
    void load(); const timer = setInterval(() => { void load(); }, 2000); return () => { active = false; clearInterval(timer); };
  }, [rootId, refresh]);
  async function download(projectId: string, chosenVersion: string, chosenFile: string): Promise<void> {
    if (!window.oucl || downloading) return; setDownloading(true); setError(undefined);
    const key = `${projectId}:${chosenVersion}:${chosenFile}`; const id = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, id);
    try { const result = await window.oucl.downloadResource(id, { projectId, versionId: chosenVersion, fileId: chosenFile });
      if (result.ok) { requests.current.delete(key); setRefresh(n => n + 1); await refreshGame(); } else { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') requests.current.delete(key); }
    } catch { setError('unavailable'); } finally { setDownloading(false); }
  }
  async function openLibrary(): Promise<void> { if (!window.oucl) return; const result = await window.oucl.openResourceLibrary(); if (!result.ok) setLibraryError(result.error.messageKey); }
  async function previewPlan(item: LibraryItem): Promise<void> {
    if (!window.oucl || !instance || planning) return;
    const key = `plan:${instance.instanceId}:${instance.revision}:${item.projectId}:${item.versionId}:${item.fileId}`;
    const requestId = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, requestId);
    activePlanRequest.current = requestId;
    setPlanning(item.taskId); setPlanError(undefined); setPlan(undefined); setPlanRequestId(undefined); setPlanCancelled(false); setInstallationAccepted(false);
    try {
      const result = await window.oucl.planMod(requestId, { instanceId: instance.instanceId, expectedRevision: instance.revision,
        root: { projectId: item.projectId, versionId: item.versionId, fileId: item.fileId }, selections: {} });
      if (activePlanRequest.current !== requestId) return;
      if (result.ok) { requests.current.delete(key); setPlan(result.data.plan); setPlanRequestId(requestId); rememberPlan(planPointer, requestId); }
      else { setPlanError(result.error.messageKey); if (result.error.code !== 'TIMEOUT' && result.error.code !== 'UNAVAILABLE') requests.current.delete(key); }
    } catch { if (activePlanRequest.current === requestId) setPlanError('unavailable'); }
    finally { if (activePlanRequest.current === requestId) setPlanning(undefined); }
  }
  async function cancelPlan(): Promise<void> {
    if (!window.oucl || !plan || !planRequestId || cancelling) return;
    const selectedRequest = planRequestId; const key = `cancel-plan:${selectedRequest}`;
    const requestId = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, requestId);
    setCancelling(true); setPlanError(undefined);
    try {
      const result = await window.oucl.cancelModPlan(requestId, { planRequestId: selectedRequest, planId: plan.planId });
      if (activePlanRequest.current !== selectedRequest) return;
      if (result.ok) { setPlanCancelled(true); rememberPlan(planPointer); requests.current.delete(key); }
      else setPlanError(result.error.messageKey);
    } catch { if (activePlanRequest.current === selectedRequest) setPlanError('unavailable'); }
    finally { if (activePlanRequest.current === selectedRequest) setCancelling(false); }
  }
  const version = versions.find(v => v.versionId === versionId);
  function selectProject(project: ResourceProject): void {
    if (selected === project) return;
    setVersions([]); setVersionId(''); setFileId(''); setVersionBusy(true); setSelected(project);
  }
  return <div className="resources-view">
    {!libraryOnly && <><div className="download-note"><span className="source-badge">Modrinth</span><p>{MESSAGES.uiResourceNotice}</p></div>
      <form className="resource-search" onSubmit={e => { e.preventDefault(); setSelected(undefined); setSearch({ query, gameVersion: gameVersion.trim(), loader, offset: 0 }); }}>
        <input aria-label={MESSAGES.uiSearchResources} placeholder={MESSAGES.uiSearchResources} maxLength={120} value={query} onChange={e => { setQuery(e.target.value); }} />
        <input aria-label={MESSAGES.uiGameVersion} placeholder={MESSAGES.uiGameVersion} maxLength={64} value={gameVersion} onChange={e => { setGameVersion(e.target.value); }} />
        <select aria-label={MESSAGES.uiLoader} value={loader} onChange={e => { setLoader(e.target.value); }}><option value="">{MESSAGES.uiAllLoaders}</option>{['fabric', 'quilt', 'forge', 'neoforge', 'iris', 'optifine', 'vanilla', 'minecraft', 'canvas'].map(item => <option key={item} value={item}>{item}</option>)}</select>
        <button disabled={!enabled || busy} type="submit">{MESSAGES.uiSearch}</button>
      </form>
      <div className="resource-grid" ref={resourceGrid} style={{ gridTemplateColumns: `minmax(0, ${listWidth}fr) 10px minmax(220px, ${100 - listWidth}fr)` }}><section className="panel resource-results" aria-busy={busy}>
        <div className="section-heading"><h2>{MESSAGES.uiDiscover}</h2>{!searchFailed && <span className="muted small">{total.toLocaleString()} {MESSAGES.uiResults}</span>}</div>
        {busy ? <p role="status">{MESSAGES.uiLoading}</p> : searchFailed ? null : projects.length === 0 ? <p className="empty-state">{MESSAGES.uiNoResults}</p> : projects.map(p => <button className="resource-row" draggable onDragStart={event => { draggedProject.current = p.projectId; event.dataTransfer.setData('application/x-oucl-resource', p.projectId); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => { draggedProject.current = undefined; setDropHover(false); }} aria-pressed={selected?.projectId === p.projectId} key={p.projectId} onClick={() => { selectProject(p); }}>
          <ResourceIcon projectId={p.projectId} title={p.title} /><span className="resource-info"><strong>{p.title}</strong><span>{p.author} · {p.downloads.toLocaleString()} {MESSAGES.uiDownloadsCount}</span><small>{p.description}</small></span><span className="row-arrow">›</span>
        </button>)}
        <div className="pagination"><button className="secondary" disabled={busy || searchFailed || search.offset === 0} onClick={() => { setSearch(s => ({ ...s, offset: Math.max(0, s.offset - 20) })); }}>{MESSAGES.uiPrevious}</button>
          <span className="muted small">{Math.floor(search.offset / 20) + 1}</span><button className="secondary" disabled={busy || searchFailed || search.offset + 20 >= total || search.offset >= 10000} onClick={() => { setSearch(s => ({ ...s, offset: s.offset + 20 })); }}>{MESSAGES.uiNext}</button></div>
      </section><div className="resource-splitter" role="separator" tabIndex={0} aria-label={MESSAGES.uiResizePanel} aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={listWidth}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = resourceGrid.current?.getBoundingClientRect(); if (bounds) setListWidth(Math.max(30, Math.min(70, Math.round((event.clientX - bounds.left) / bounds.width * 100)))); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); setListWidth(value => Math.max(30, Math.min(70, value + (event.key === 'ArrowLeft' ? -5 : 5)))); }} />
      <aside className={`panel resource-detail ${dropHover ? 'drop-hover' : ''}`} onDragOver={event => { if (!draggedProject.current) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropHover(true); }} onDragLeave={() => { setDropHover(false); }}
        onDrop={event => { const id = event.dataTransfer.getData('application/x-oucl-resource'); const project = projects.find(p => p.projectId === id && id === draggedProject.current); if (!project) return; event.preventDefault(); selectProject(project); setDropHover(false); draggedProject.current = undefined; }}>
        <p className="resource-drop-hint">{dropHover ? MESSAGES.uiDropReady : MESSAGES.uiDropDownload}</p>
        {!selected ? <div className="empty-state"><span className="empty-glyph">↓</span><h2>{MESSAGES.uiChooseResource}</h2><p>{MESSAGES.uiResourceDetailHint}</p></div> : <><span className="eyebrow">MODRINTH</span><h2>{selected.title}</h2><p className="muted">{selected.author}</p>
          {versionBusy ? <p role="status">{MESSAGES.uiLoading}</p> : versions.length === 0 ? <p>{MESSAGES.uiNoVersions}</p> : <>
            <label>{MESSAGES.uiResourceVersion}<select value={versionId} onChange={e => { const v = versions.find(v => v.versionId === e.target.value); setVersionId(e.target.value); setFileId(v?.files.find(f => f.primary)?.fileId ?? v?.files[0]?.fileId ?? ''); }}>{versions.map(v => <option key={v.versionId} value={v.versionId}>{v.name}</option>)}</select></label>
            <p className="compatibility">{version?.gameVersions.join(' · ')}<br />{version?.loaders.join(' · ')}</p>
            <label>{MESSAGES.uiResourceFile}<select value={fileId} onChange={e => { setFileId(e.target.value); }}>{version?.files.map(f => <option key={f.fileId} value={f.fileId}>{f.filename} · {size(f.size)}</option>)}</select></label>
            <p className="muted small">{MESSAGES.uiResourceNotice}</p><button className="primary" disabled={!rootId || !fileId || downloading} onClick={() => { void download(selected.projectId, versionId, fileId); }}>{downloading ? MESSAGES.uiSubmitting : MESSAGES.uiDownloadLibrary}</button>
            {!rootId && <p className="form-error">{MESSAGES.chooseRootFirst}</p>}
          </>}
        </>}
      </aside></div></>}
    {error && <div className="error-banner" role="alert">{MESSAGES[error]} <button className="text-button" onClick={() => { setRefresh(n => n + 1); }}>{MESSAGES.uiRetry}</button></div>}
    <section className="panel library-panel"><div className="section-heading"><h2>{MESSAGES.uiLibrary}</h2><button className="secondary" disabled={!rootId} onClick={() => { void openLibrary(); }}>{MESSAGES.uiOpenLibrary}</button></div>
      {!rootId ? <p className="empty-state">{MESSAGES.chooseRootFirst}</p> : library.length === 0 ? <p className="empty-state">{MESSAGES.uiEmptyLibrary}</p> : [...library].reverse().map(item => {
        const task = tasks.find(t => t.taskId === item.taskId); const failure = item.errorCode ? resourceFailure(item.taskId, item.errorCode, item.taskId) : undefined; return <article className="library-item" key={item.taskId}><div><strong>{item.title}</strong><span className="tag">{item.kind === 'mod' ? MESSAGES.uiMods : item.kind === 'shader' ? MESSAGES.uiShaders : MESSAGES.uiResourcepacks}</span>
          <p className="muted small">{item.versionName} · {item.filename} · {size(item.size)}</p></div>
          {item.downloaded ? <><span className="success">{MESSAGES.uiDownloaded}</span>{item.kind === 'mod' && modPlansEnabled && instance &&
            <button className="secondary" disabled={!!planning || cancelling || instance.state !== 'ready'} onClick={() => { void previewPlan(item); }}>{planning === item.taskId ? MESSAGES.modsPlanning : MESSAGES.modsPlan}</button>}</> : task && <InstallTask initial={task} onSettled={refreshGame} />}
          {failure && !failure.ok && <p className="form-error" role="alert">{MESSAGES[failure.error.messageKey]}</p>}
          {!item.downloaded && !task && <><p>{MESSAGES.taskObservationUnconfirmed}</p><button onClick={() => { void queryTask(item.taskId); }}>{MESSAGES.taskQueryOriginal}</button></>}
          {taskQueryErrors[item.taskId] && <p role="status">{MESSAGES[taskQueryErrors[item.taskId]!]}</p>}
          {!item.downloaded && task && ['failed', 'cancelled'].includes(task.state) && <button className="secondary" disabled={downloading} onClick={() => { void download(item.projectId, item.versionId, item.fileId); }}>{MESSAGES.uiRetry}</button>}
          {plan?.rootVersionId === item.versionId && plan.instanceId === instance?.instanceId && <div className="mod-plan-preview" data-plan-state={plan.state}>
            <strong>{planCancelled ? MESSAGES.modsPlanCancelled : plan.state === 'ready' ? MESSAGES.modsPlanReady : plan.state === 'conflict' ? MESSAGES.modsPlanConflict : MESSAGES.modsPlanUnknown}</strong>
            <p>{MESSAGES.modsPlanFiles}: {plan.items.length} · {MESSAGES.modsPlanDownload}: {size(plan.totalDownloadBytes)}</p>
            <ul>{plan.items.map(file => <li key={file.projectId}><strong>{file.filename}</strong> · Modrinth · {file.projectId} / {file.versionId} · {size(file.size)} · {file.disposition === 'reuse' ? MESSAGES.modsPlanReuse : file.disposition === 'library' ? MESSAGES.uiDownloaded : MESSAGES.modsPlanDownload}
              {file.requiredBy.length > 0 && <p className="muted small">{MESSAGES.modsRequiredBy}: {file.requiredBy.map(id => plan.items.find(parent => parent.projectId === id)?.filename ?? id).join(' · ')}</p>}</li>)}</ul>
            {!planCancelled && planRequestId && <ModInstallConfirmation key={planRequestId} plan={plan} planRequestId={planRequestId} onAccepted={setInstallationAccepted} onRefresh={refreshGame} />}
            {!planCancelled && !installationAccepted && planRequestId && <button className="secondary" disabled={cancelling || !!planning} onClick={() => { void cancelPlan(); }}>{cancelling ? MESSAGES.uiSubmitting : MESSAGES.modsPlanCancel}</button>}
          </div>}
        </article>;
      })}
      {libraryError && <p className="form-error" role="alert">{MESSAGES[libraryError]}</p>}
      {planError && <p className="form-error" role="alert">{MESSAGES[planError]}</p>}
      {planning === 'restore' && <p role="status">{MESSAGES.modsPlanRestoring}</p>}
    </section>
  </div>;
}
