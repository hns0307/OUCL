import { useCallback, useEffect, useRef, useState } from 'react';
import { MESSAGES, MOD_ISSUE_MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { InstanceSummary, TaskSnapshot } from '../shared/contracts/instances.js';
import type { ModReport } from '../shared/contracts/mods-report.js';
import { InstallTask } from './InstallPanel.js';
import { MaintenancePreviewPanel } from './MaintenancePreviewPanel.js';

const terminal = (task: TaskSnapshot): boolean => ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(task.state);
const stateLabel = (state: ModReport['state']): string => state === 'satisfied' ? MESSAGES.modsSatisfied : state === 'unsatisfied' ? MESSAGES.modsUnsatisfied : MESSAGES.modsUnknown;
const reason = (code: string): string => MOD_ISSUE_MESSAGES[code] ?? MESSAGES.modsUnknownReason;

/** Read-only instance inspection. Historical reports never authorize a filesystem change. */
export function ModPanel({ instance, enabled, targetsEnabled, rootId, maintenanceEnabled }: { instance: InstanceSummary; enabled: boolean; targetsEnabled: boolean;
  rootId: string | undefined; maintenanceEnabled: boolean }) {
  const [report, setReport] = useState<ModReport>(); const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<MessageKey>();
  const generation = useRef(0); const pending = useRef<{ id: string; mode: 'list' | 'check' } | undefined>(undefined);
  const settledTasks = useRef(new Set<string>());
  const readReport = useCallback(async (taskId: string, ticket: number): Promise<boolean> => {
    if (!window.oucl) return false;
    const result = await window.oucl.modReport(taskId); if (ticket !== generation.current) return false;
    if (!result.ok) { setError(result.error.messageKey); return false; }
    if (result.data.report?.instanceId === instance.instanceId) { setReport(result.data.report); return true; }
    if (result.data.errorCode) setError(result.data.errorCode === 'CANCELLED' ? 'modsCancelled' : result.data.errorCode === 'FILES_CHANGED' ? 'modsChanged' : 'modsScanFailed');
    return false;
  }, [instance.instanceId]);
  useEffect(() => {
    const ticket = ++generation.current; setReport(undefined); setTasks([]); setError(undefined); setBusy(false);
    setRecoveryUnavailable(!targetsEnabled); pending.current = undefined; settledTasks.current.clear();
    if (enabled && targetsEnabled && window.oucl) {
      setBusy(true); const bridge = window.oucl;
      void (async () => {
        let rows: TaskSnapshot[] = []; let cursor: string | undefined; let restarted = false;
        for (let page = 0; page < 20; page++) {
          const listed = await bridge.listInstanceTaskTargets({ instanceId: instance.instanceId, kinds: ['mod-check'], limit: 100, ...(cursor ? { cursor } : {}) });
          if (ticket !== generation.current) return;
          if (!listed.ok) {
            if (listed.error.code === 'CURSOR_EXPIRED' && !restarted) { restarted = true; rows = []; cursor = undefined; page = -1; continue; }
            setRecoveryUnavailable(true); setError(listed.error.messageKey); return;
          }
          rows.push(...listed.data.items.map(item => item.task)); cursor = listed.data.nextCursor;
          if (!cursor) break;
        }
        if (cursor) { setRecoveryUnavailable(true); setError('unavailable'); return; }
        if (ticket !== generation.current) return;
        setTasks(rows.filter(item => !terminal(item)));
        // Ordering is deterministic identity order, not an admission timestamp.
        for (const item of rows.filter(item => item.state === 'completed')) {
          if (await readReport(item.taskId, ticket) || ticket !== generation.current) break;
        }
      })().catch(() => { if (ticket === generation.current) { setRecoveryUnavailable(true); setError('unavailable'); } })
        .finally(() => { if (ticket === generation.current) setBusy(false); });
    }
    return () => { generation.current++; };
  }, [instance.instanceId, instance.revision, rootId, enabled, targetsEnabled, readReport]);
  const settled = useCallback((value: TaskSnapshot) => {
    if (settledTasks.current.has(value.taskId)) return; settledTasks.current.add(value.taskId);
    setTasks(current => current.map(task => task.taskId === value.taskId ? value : task)); const ticket = generation.current;
    void readReport(value.taskId, ticket).catch(() => { if (ticket === generation.current) setError('unavailable'); });
  }, [readReport]);
  async function start(mode: 'list' | 'check'): Promise<void> {
    const bridge = window.oucl; if (!bridge || busy || tasks.some(task => !terminal(task))) return;
    const ticket = generation.current; setBusy(true); setError(undefined);
    // A timed-out acceptance is retried with the same identity, avoiding a duplicate scan.
    if (!pending.current || pending.current.mode !== mode) pending.current = { id: crypto.randomUUID(), mode };
    try {
      const result = await (mode === 'list' ? bridge.listMods : bridge.checkMods)(pending.current.id, { instanceId: instance.instanceId, expectedRevision: instance.revision });
      if (ticket !== generation.current) return;
      if (!result.ok) { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT' && result.error.code !== 'UNAVAILABLE') pending.current = undefined; return; }
      const current = await bridge.getTask(result.data.taskId); if (ticket !== generation.current) return;
      if (!current.ok) { setError(current.error.messageKey); return; }
      pending.current = undefined; settledTasks.current.delete(current.data.snapshot.taskId);
      setTasks(previous => [...previous.filter(task => task.taskId !== current.data.snapshot.taskId), current.data.snapshot]);
      if (terminal(current.data.snapshot)) settled(current.data.snapshot);
    } catch { if (ticket === generation.current) setError('unavailable'); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  if (!enabled) return null;
  const stale = report && report.instanceRevision !== instance.revision;
  const working = busy || tasks.some(task => !terminal(task));
  return <section className="panel mods-panel" aria-label={MESSAGES.modsTitle}>
    <div className="section-heading"><h2>{MESSAGES.modsTitle}</h2><span className="tag">{instance.displayName}</span></div>
    <p className="muted small">{MESSAGES.modsReadOnlyHint}</p>
    <div className="mods-actions"><button disabled={working || instance.state !== 'ready'} onClick={() => { void start('list'); }}>{MESSAGES.modsReadList}</button>
      <button className="primary" disabled={working || instance.state !== 'ready'} onClick={() => { void start('check'); }}>{MESSAGES.modsCheck}</button></div>
    {recoveryUnavailable && <p role="status" className="storage-note">{MESSAGES.modsTargetUnavailable}</p>}
    {!!tasks.length && <p className="storage-note">{MESSAGES.modsTaskHint}</p>}
    {tasks.map(task => <InstallTask key={task.taskId} initial={task} onSettled={settled} />)}
    {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
    {!report ? <p className="muted">{MESSAGES.modsNoReport}</p> : <div className="mod-report" data-mod-state={report.state} data-instance-id={report.instanceId} data-report-time={report.checkedAt} data-report-mode={report.mode}>
      <div className="mods-summary"><strong>{stateLabel(report.state)}</strong><span>{report.mode === 'check' ? MESSAGES.modsDual : MESSAGES.modsLocal}</span></div>
      <p className="storage-note">{MESSAGES.modsObserved} {new Date(report.checkedAt).toLocaleString()} · {MESSAGES.modsRevision} {report.instanceRevision}</p>
      {stale && <p role="status" className="form-error">{MESSAGES.modsStale}</p>}
      <p className="storage-note">{MESSAGES.modsRuntimeHint}</p>
      {!report.files.length && <p>{MESSAGES.modsEmpty}</p>}
      <ul className="mod-files">{report.files.map(file => <li key={file.fileId}>
        <div className="mods-summary"><strong>{file.filename}</strong><span className="tag">{file.enabled ? MESSAGES.modsEnabled : MESSAGES.modsDisabled}</span></div>
        {maintenanceEnabled && rootId && <MaintenancePreviewPanel key={`${rootId}:${report.fingerprint}:${file.fileId}`} rootId={rootId} report={report} file={file}
          disabled={working || !!stale || instance.state !== 'ready'} />}
        {file.mods.map((mod, index) => <p key={`${mod.id}:${index}`}>{mod.name} · <code>{mod.id}</code> · {mod.version ?? MESSAGES.modsUnknown} <small>({mod.format})</small></p>)}
        {!file.mods.length && <p>{MESSAGES.modsUnknownDeclaration}</p>}
        <p className="storage-note">{MESSAGES.modsSource} {file.sourceStatus === 'matched' ? MESSAGES.modsSourceMatched : file.sourceStatus === 'conflict' ? MESSAGES.modsSourceConflict : MESSAGES.modsUnknown}
          {file.source && <> · {file.source.projectId} / {file.source.versionId} · {file.source.versionName}</>}</p>
        <details><summary>{MESSAGES.modsEvidence}</summary><dl><dt>SHA-256</dt><dd>{file.sha256 ?? MESSAGES.modsUnknown}</dd><dt>SHA-512</dt><dd>{file.sha512 ?? MESSAGES.modsUnknown}</dd></dl>
          {file.issues.map(code => <p key={code}>{reason(code)} <code>{code}</code></p>)}</details>
      </li>)}</ul>
      {!!report.issues.length && <details className="mod-issues" open><summary>{MESSAGES.modsFindings} ({report.issues.length})</summary><ul>{report.issues.map((issue, index) => <li key={index}>
        <strong>{issue.severity === 'error' ? MESSAGES.modsIssueError : issue.severity === 'unknown' ? MESSAGES.modsUnknown : MESSAGES.modsIssueWarning} · {reason(issue.code)}</strong>
        <p>{issue.scope === 'local' ? MESSAGES.modsDeclaration : 'Modrinth'} · {report.files.find(file => file.fileId === issue.fileId)?.filename ?? MESSAGES.modsEnvironment}
          {issue.modId && <> · {MESSAGES.modsRequiredBy} <code>{issue.modId}</code></>}
          {(issue.targetModId || issue.targetProjectId || issue.targetVersionId) && <> → <code>{issue.targetModId ?? issue.targetProjectId ?? issue.targetVersionId}</code></>}</p>
        {issue.requirement && <p>{MESSAGES.modsRequirement} <code>{issue.requirement}</code></p>}
        {!!issue.actual.length && <p>{MESSAGES.modsActual} {issue.actual.join(', ')}</p>}
        {!!issue.via.length && <p>{MESSAGES.modsEmbedded} {issue.via.join(' → ')}</p>}
        <small><code>{issue.code}</code></small>
      </li>)}</ul></details>}
    </div>}
  </section>;
}
