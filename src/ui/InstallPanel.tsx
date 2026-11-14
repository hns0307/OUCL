import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { InstallStage, InstanceBridge, TaskSnapshot } from '../shared/contracts/instances.js';
import { TaskObserverPool } from './task-observer.js';
import type { TaskObservation } from './task-observer.js';
import { rendererTaskReads } from './task-query.js';
import { instanceFailure } from '../shared/contracts/instances.js';
import { useLauncher } from './launcher-state.js';
import type { LoaderKind, LoaderVersionItem } from '../shared/contracts/loaders.js';
import { canInstallLoaderMinecraft, LOADER_INSTALL_TARGETS, preferredLoaderVersion } from '../shared/contracts/loader-targets.js';

const STAGE_MESSAGES: Record<InstallStage, MessageKey> = { metadata: 'stageMetadata', downloading: 'stageDownloading', materializing: 'stageMaterializing',
  committing: 'stageCommitting', completed: 'stageCompleted', failed: 'stageFailed', cancelled: 'stageCancelled', needsRecovery: 'stageRecovery', queued: 'stageQueued', preparing: 'stagePreparing' };
function bytes(value: number): string {
  const units = [MESSAGES.byteUnit, MESSAGES.kilobyteUnit, MESSAGES.megabyteUnit, MESSAGES.gigabyteUnit]; let unit = 0; let number = value;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit++; }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number)} ${units[unit]}`;
}
function terminal(snapshot: TaskSnapshot): boolean { return ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(snapshot.state); }
function taskLabel(snapshot: TaskSnapshot): MessageKey {
  if (snapshot.kind === 'launch' || snapshot.kind === 'stop') {
    if (snapshot.state === 'cancelled') return 'stageCancelled';
    if (snapshot.state === 'needsRecovery') return 'stageRecovery';
    if (snapshot.kind === 'launch') return snapshot.state === 'completed' ? 'launchTaskDone' : snapshot.state === 'failed' ? 'launchTaskFailed' : 'launchTaskPending';
    return snapshot.state === 'completed' ? 'stopTaskDone' : snapshot.state === 'failed' ? 'stopTaskFailed' : 'stopTaskPending';
  }
  if (snapshot.kind === 'mod-install') return snapshot.state === 'completed' ? 'modsInstalled'
    : snapshot.state === 'failed' ? 'modsInstallFailed' : snapshot.state === 'cancelled' ? 'modsInstallCancelled'
      : snapshot.state === 'needsRecovery' ? 'modsInstallRecovery' : 'modsInstalling';
  if (snapshot.kind !== 'mod-check') return STAGE_MESSAGES[snapshot.stage];
  return snapshot.state === 'completed' ? 'modsCheckCompleted' : snapshot.state === 'failed' ? 'modsCheckFailed'
    : snapshot.state === 'cancelled' ? 'modsCheckCancelled' : snapshot.state === 'needsRecovery' ? 'modsCheckRecovery' : 'modsChecking';
}

let observationContext: { bridge: InstanceBridge; rootId: string | undefined; pool: TaskObserverPool; visibility: () => void } | undefined;
function taskPool(bridge: InstanceBridge, rootId: string | undefined): TaskObserverPool {
  if (observationContext?.bridge === bridge && observationContext.rootId === rootId) return observationContext.pool;
  if (observationContext) { observationContext.pool.close(); document.removeEventListener('visibilitychange', observationContext.visibility); }
  const valid = (): boolean => observationContext?.pool === pool && !document.hidden;
  const pool = new TaskObserverPool({
    getTask: async taskId => await rendererTaskReads.run(() => bridge.getTask(taskId), valid)
      ?? instanceFailure<'tasks:get'>(crypto.randomUUID(), 'UNAVAILABLE', crypto.randomUUID()),
    subscribeTask: async (taskId, listener) => await rendererTaskReads.run(() => bridge.subscribeTask(taskId, listener), valid)
      ?? { result: instanceFailure<'tasks:subscribe'>(crypto.randomUUID(), 'UNAVAILABLE', crypto.randomUUID()), dispose: () => {} },
  }, bridge); const visibility = (): void => { pool.setVisible(!document.hidden); };
  visibility(); document.addEventListener('visibilitychange', visibility);
  observationContext = { bridge, rootId, pool, visibility }; return pool;
}

export function InstallTask({ initial, onSettled }: { initial: TaskSnapshot; onSettled: (snapshot: TaskSnapshot) => void }) {
  const [snapshot, setSnapshot] = useState(initial); const [error, setError] = useState<MessageKey>(); const [cancelling, setCancelling] = useState(false);
  const rootId = useLauncher(state => state.rootId);
  const [observation, setObservation] = useState<TaskObservation>({ snapshot: initial, connection: 'unconfirmed' });
  const reconnect = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { setSnapshot(current => initial.revision > current.revision ? initial : current); }, [initial]);
  useEffect(() => {
    if (!window.oucl) return;
    const observer = taskPool(window.oucl, rootId).observe(initial, value => {
      setObservation(value); setSnapshot(current => value.snapshot.revision >= current.revision ? value.snapshot : current);
    });
    reconnect.current = observer.reconnect;
    return () => { reconnect.current = undefined; observer.dispose(); };
  }, [initial.taskId, rootId]);
  useEffect(() => { if (terminal(snapshot)) onSettled(snapshot); }, [snapshot.state, onSettled]);
  async function cancel(): Promise<void> {
    if (!window.oucl || cancelling) return; setCancelling(true); setError(undefined);
    const result = await window.oucl.controlTask(snapshot.taskId, 'cancel');
    if (!result.ok) { setError(result.error.messageKey); setCancelling(false); }
  }
  return <article className="install-task" data-task-id={snapshot.taskId} data-task-state={snapshot.state}>
    <div className="task-heading"><strong>{MESSAGES[taskLabel(snapshot)]}</strong>
      {!terminal(snapshot) && <button disabled={cancelling || snapshot.state === 'committing' || snapshot.state === 'cancelling'} onClick={() => { void cancel(); }}>{MESSAGES[snapshot.kind === 'install' ? 'cancelTask' : 'taskCancelGeneric']}</button>}
    </div>
    {snapshot.bytesTotal !== undefined && <><progress max={snapshot.bytesTotal || 1} value={snapshot.bytesDone} /><p className="storage-note">{MESSAGES.preparedBytes} {bytes(snapshot.bytesDone)} / {bytes(snapshot.bytesTotal)}</p></>}
    {(cancelling || snapshot.state === 'cancelling') && !terminal(snapshot) && <p role="status">{MESSAGES[snapshot.kind === 'install' ? 'cancellingTask' : 'taskCancellingGeneric']}</p>}
    <p className="storage-note" role="status" data-observation-state={observation.connection}>
      {MESSAGES[observation.connection === 'confirmed' ? 'taskObservationConfirmed' : observation.connection === 'connecting' || observation.connection === 'rechecking' ? 'taskObservationChecking' : 'taskObservationUnconfirmed']}
      {observation.lastConfirmedAt !== undefined && <> · {MESSAGES.taskObservationLastConfirmed} {new Date(observation.lastConfirmedAt).toLocaleTimeString()}</>}
      {observation.code === 'TASK_NOT_FOUND' && <> · {MESSAGES.taskObservationNotFound}</>}
      {observation.code === 'ROOT_UNAVAILABLE' && <> · {MESSAGES.rootUnavailable}</>}
    </p>
    {(observation.connection === 'unavailable' || observation.connection === 'unconfirmed') && <button onClick={() => { reconnect.current?.(); }}>{MESSAGES.taskObservationReconnect}</button>}
    {(error || snapshot.error) && <p role="alert" className="form-error">{MESSAGES[error ?? snapshot.error!.messageKey]}</p>}
  </article>;
}

/** Connects the approved vanilla instance/task flow; all network, files and process work stays behind preload. */
export function InstallPanel({ enabled, loadersEnabled, rootId, versionId }: { enabled: boolean; loadersEnabled: boolean; rootId: string | undefined; versionId: string | undefined }) {
  const { settings, refreshGame } = useLauncher();
  const [displayName, setDisplayName] = useState(''); const [isolation, setIsolation] = useState<'on' | 'off'>('on');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<MessageKey>();
  const [loader, setLoader] = useState<'vanilla' | LoaderKind>('vanilla');
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionItem[]>([]); const [loaderVersion, setLoaderVersion] = useState(''); const [loaderBusy, setLoaderBusy] = useState(false);
  const [loaderCatalogFor, setLoaderCatalogFor] = useState<string>(); const [loaderRefresh, setLoaderRefresh] = useState(0);
  const requestId = useRef<string | undefined>(undefined); const accepted = useRef(false);
  const target = loader === 'vanilla' ? undefined : LOADER_INSTALL_TARGETS[loader];
  const loaderSupported = loader === 'vanilla' || !!versionId && canInstallLoaderMinecraft(loader, versionId);
  const catalogMatches = loader === 'vanilla' || loaderCatalogFor === `${loader}:${versionId}`;
  useEffect(() => { setDisplayName(versionId ?? ''); requestId.current = undefined; accepted.current = false; setError(undefined); }, [versionId, rootId]);
  useEffect(() => { setIsolation(settings?.isolationDefault === false ? 'off' : 'on'); }, [versionId, settings?.isolationDefault]);
  useEffect(() => {
    setLoaderCatalogFor(undefined); setLoaderVersions([]); setLoaderVersion('');
    if (!window.oucl || !versionId || loader === 'vanilla' || !loadersEnabled) { setLoaderBusy(false); return; }
    if (!canInstallLoaderMinecraft(loader, versionId)) { setLoaderBusy(false); setError('loaderVersionUnsupported'); return; }
    let active = true; setLoaderBusy(true); setError(undefined); requestId.current = undefined; accepted.current = false;
    void window.oucl.loaderVersions({ minecraftVersion: versionId, loader }).then(result => {
      if (!active) return;
      if (result.ok) { setLoaderVersions(result.data.items); setLoaderVersion(preferredLoaderVersion(loader, versionId, result.data.items)); setLoaderCatalogFor(`${loader}:${versionId}`); }
      else { setLoaderVersions([]); setLoaderVersion(''); setError(result.error.messageKey); }
    }).catch(() => { if (active) setError('unavailable'); }).finally(() => { if (active) setLoaderBusy(false); });
    return () => { active = false; };
  }, [loader, loadersEnabled, versionId, loaderRefresh]);
  async function install(): Promise<void> {
    if (!window.oucl || !rootId || !versionId || busy || accepted.current || !loaderSupported || !catalogMatches
      || loader !== 'vanilla' && (!loaderVersion || !loaderVersions.some(item => item.loaderVersion === loaderVersion))) return;
    setBusy(true); setError(undefined); const id = requestId.current ??= crypto.randomUUID();
    try {
      const result = loader === 'vanilla' ? await window.oucl.createInstance(id, { rootId, mcVersionId: versionId, displayName: displayName.trim(), isolation })
        : await window.oucl.createLoaderInstance(id, { rootId, minecraftVersion: versionId, loader, loaderVersion, displayName: displayName.trim(), isolation: 'on' });
      if (requestId.current !== id) { await refreshGame(); return; }
      if (!result.ok) { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT' && result.error.code !== 'UNAVAILABLE') requestId.current = undefined; return; }
      accepted.current = true; await refreshGame();
    } catch { setError('unavailable'); } finally { setBusy(false); }
  }
  if (!enabled) return null;
  return <div className="installation-column"><section className="card install-confirm" aria-labelledby="install-title"><h2 id="install-title">{MESSAGES.installTitle}</h2>
    {!versionId ? <div className="empty-state"><span className="empty-glyph">↓</span><p>{MESSAGES.installPrompt}</p></div> : <><div className="selected-version">{versionId}</div>
      <label>{MESSAGES.uiLoader}<select value={loader} disabled={busy} onChange={event => { setLoader(event.target.value as typeof loader); requestId.current = undefined; accepted.current = false; }}>
        <option value="vanilla">{MESSAGES.uiVanilla}</option>{loadersEnabled && <><option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></>}
      </select></label>
      {loader !== 'vanilla' && <label>{MESSAGES.loaderVersion}<select value={catalogMatches ? loaderVersion : ''} disabled={busy || !catalogMatches || loaderBusy || loaderVersions.length === 0} onChange={event => { setLoaderVersion(event.target.value); requestId.current = undefined; accepted.current = false; }}>
        <option value="" disabled>{MESSAGES.loaderChooseVersion}</option>
        {(catalogMatches ? loaderVersions : []).map(item => <option key={item.loaderVersion} value={item.loaderVersion}>{item.loaderVersion}{item.stable ? ` · ${MESSAGES.loaderStable}` : ''}</option>)}
      </select></label>}
      {target && <p className="storage-note loader-target">{MESSAGES.loaderTarget} Minecraft {target.minecraftVersion} · {target.loaderVersion} · Java {target.javaMajor}</p>}
      {loader !== 'vanilla' && loaderSupported && !loaderBusy && loaderVersions.length === 0 && <button disabled={busy} onClick={() => { setLoaderRefresh(value => value + 1); }}>{MESSAGES.loaderRetryCatalog}</button>}
      <label>{MESSAGES.instanceName}<input value={displayName} disabled={busy} maxLength={80} onChange={event => { setDisplayName(event.target.value); requestId.current = undefined; accepted.current = false; }} /></label>
      <select aria-label={MESSAGES.isolationOn} value={loader === 'vanilla' ? isolation : 'on'} disabled={busy || loader !== 'vanilla'} onChange={event => { setIsolation(event.target.value as 'on' | 'off'); requestId.current = undefined; accepted.current = false; }}><option value="on">{MESSAGES.isolationOn}</option><option value="off">{MESSAGES.isolationOff}</option></select>
      {loader !== 'vanilla' && <p className="storage-note">{MESSAGES.loaderUnverified}</p>}
      <p className="storage-note">{MESSAGES.installHint}</p>{!rootId && <p>{MESSAGES.chooseRootFirst}</p>}
      <button className="primary" disabled={busy || loaderBusy || !loaderSupported || !catalogMatches || !rootId || !displayName.trim() || accepted.current || loader !== 'vanilla' && !loaderVersion} onClick={() => { void install(); }}>{busy || loaderBusy ? MESSAGES.installAccepting : MESSAGES.installConfirm}</button>
    </>}{error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}</section>
  </div>;
}
