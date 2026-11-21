import { useEffect, useRef, useState } from 'react';
import type { ModFileSummary, ModReport } from '../shared/contracts/mods-report.js';
import type { MaintenanceDisplay, PreviewCode, PreviewSnapshot } from '../shared/contracts/mod-maintenance-preview.js';
import { isModCode, modFailure } from '../shared/contracts/mods.js';
import { MESSAGES, MOD_ISSUE_MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';

function failureMessage(code: PreviewCode): MessageKey {
  if (code === 'PREVIEW_EXPIRED') return 'modsPreviewExpired';
  if (isModCode(code)) {
    const error = modFailure('00000000-0000-4000-8000-000000000001', code, '00000000-0000-4000-8000-000000000001');
    if (!error.ok) return error.error.messageKey;
  }
  return 'modsScanFailed';
}

/** A read-only observation; closing this component never cancels an accepted scan. */
export function MaintenancePreviewPanel({ rootId, report, file, disabled }: { rootId: string; report: ModReport; file: ModFileSummary; disabled: boolean }) {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>(); const [error, setError] = useState<MessageKey>();
  const [accepting, setAccepting] = useState(false); const [refresh, setRefresh] = useState(0);
  const requestId = useRef<string | undefined>(undefined); const generation = useRef(0); const action = file.enabled ? 'disable' : 'enable';
  const active = snapshot?.status === 'running' || snapshot?.status === 'queued';
  const observationError = (code: PreviewCode, messageKey: MessageKey): void => {
    if (code === 'PREVIEW_EXPIRED') {
      generation.current++; requestId.current = undefined; setSnapshot(undefined);
      setError('modsPreviewExpired');
    } else setError(messageKey);
  };
  const matches = (result: MaintenanceDisplay): boolean => result.rootId === rootId && result.instanceId === report.instanceId
    && result.instanceRevision === report.instanceRevision && result.fingerprint === report.fingerprint
    && result.fileId === file.fileId && result.filename === file.filename && result.sha256 === file.sha256 && result.action === action;
  useEffect(() => {
    const previewId = snapshot?.previewId; if (!previewId || !active || !window.oucl) return;
    const bridge = window.oucl; const ticket = ++generation.current; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const result = await bridge.maintenancePreviewStatus(previewId); if (ticket !== generation.current) return;
        if (!result.ok) { observationError(result.error.code, result.error.messageKey); return; }
        const current = result.data;
        if (current.result && !matches(current.result)) { setError('unavailable'); return; }
        setSnapshot(current); setError(undefined);
        if (current.status === 'queued' || current.status === 'running') timer = setTimeout(() => { void poll(); }, 1000);
      } catch { if (ticket === generation.current) setError('unavailable'); }
    };
    void poll(); return () => { generation.current++; clearTimeout(timer); };
  }, [snapshot?.previewId, active, refresh, rootId, report.instanceId, report.instanceRevision, report.fingerprint, file.fileId, file.filename, file.sha256, action]);
  async function start(): Promise<void> {
    if (!window.oucl || accepting || active || disabled) return;
    setAccepting(true); setError(undefined); requestId.current ??= crypto.randomUUID();
    try {
      const result = await window.oucl.maintenancePreview(requestId.current, { rootId, instanceId: report.instanceId,
        expectedRevision: report.instanceRevision, expectedFingerprint: report.fingerprint, fileId: file.fileId, action });
      if (!result.ok) { setError(result.error.code === 'PREVIEW_EXPIRED' ? 'modsPreviewExpired' : result.error.messageKey);
        if (result.error.code !== 'TIMEOUT' && result.error.code !== 'UNAVAILABLE') requestId.current = undefined; return; }
      requestId.current = undefined; setSnapshot({ previewId: result.data.previewId, status: 'queued', result: null, errorCode: null });
    } catch { setError('unavailable'); } finally { setAccepting(false); }
  }
  async function cancel(): Promise<void> {
    if (!window.oucl || !snapshot) return;
    generation.current++; setAccepting(true);
    try {
      const result = await window.oucl.maintenancePreviewCancel(snapshot.previewId);
      if (!result.ok) { observationError(result.error.code, result.error.messageKey); return; }
      // Query the terminal result, because completion can win the cancellation race.
      const latest = await window.oucl.maintenancePreviewStatus(snapshot.previewId);
      if (latest.ok && (!latest.data.result || matches(latest.data.result))) {
        setSnapshot(latest.data);
        if (latest.data.status !== 'queued' && latest.data.status !== 'running') setError(undefined);
      }
      else if (!latest.ok) observationError(latest.error.code, latest.error.messageKey);
      else setError('unavailable');
    } catch { setError('unavailable'); } finally { setAccepting(false); }
  }
  const names = (ids: string[]): string => ids.map(id => report.files.find(item => item.fileId === id)?.filename
    ?? `${id} (${MESSAGES.modsUnknown})`).join('、');
  const result = snapshot?.result;
  return <div className="maintenance-preview">
    <button disabled={disabled || accepting || !!active} onClick={() => { void start(); }}>
      {file.enabled ? MESSAGES.modsPreviewDisable : MESSAGES.modsPreviewEnable}</button>
    {active && <><span role="status"> {snapshot?.status === 'queued' ? MESSAGES.modsPreviewPending : MESSAGES.modsPreviewWorking}</span>{' '}
      <button disabled={accepting} onClick={() => { void cancel(); }}>{MESSAGES.modsPreviewCancel}</button></>}
    {error && <p role="alert">{MESSAGES[error]} {active && <button onClick={() => { setRefresh(value => value + 1); }}>{MESSAGES.modsPreviewQuery}</button>}</p>}
    {snapshot?.status === 'failed' && snapshot.errorCode && <p role="alert">{MESSAGES[failureMessage(snapshot.errorCode)]}</p>}
    {snapshot?.status === 'cancelled' && <p role="status">{MESSAGES.modsCancelled}</p>}
    {result && <section aria-label={MESSAGES.modsPreviewDisclaimer}>
      <p><strong>{result.state === 'ready' ? MESSAGES.modsPreviewReady : result.state === 'blocked' ? MESSAGES.modsPreviewBlocked : MESSAGES.modsPreviewUnknown}</strong></p>
      <p className="storage-note">{MESSAGES.modsPreviewDisclaimer}</p>
      {result.incomplete && <p role="status">{MESSAGES.modsPreviewIncomplete}</p>}
      {result.platformFailures.map((failure, index) => <p key={index}>{isModCode(failure) ? MESSAGES[failureMessage(failure)] : MESSAGES.modsPreviewUnknown}</p>)}
      {!!result.providers.length && <p>{MESSAGES.modsPreviewProviders}：{result.providers.map(provider => `${provider.id}${provider.ownerId !== provider.id ? ` (${provider.ownerId})` : ''}`).join('、')}</p>}
      {!!result.directRequiredBy.length && <p>{MESSAGES.modsPreviewDirect}：{names(result.directRequiredBy)}</p>}
      {!!result.transitiveRequiredBy.length && <p>{MESSAGES.modsPreviewTransitive}：{names(result.transitiveRequiredBy)}</p>}
      {!!result.relations.length && <details><summary>{MESSAGES.modsPreviewRelations} ({result.relations.length})</summary><ul>{result.relations.map((relation, index) => <li key={index}>
        {names([relation.dependentFileId])} → {names([relation.providerFileId])} · {relation.optional ? MESSAGES.modsPreviewOptional : MESSAGES.modsPreviewRequired}
        {' '}<code>{relation.dependencyModId ?? relation.dependencyProjectId ?? relation.dependencyVersionId}</code></li>)}</ul></details>}
      {!!result.issues.length && <ul>{result.issues.map((issue, index) => <li key={index}>
        <strong>{issue.severity === 'error' ? MESSAGES.modsIssueError : issue.severity === 'warning' ? MESSAGES.modsIssueWarning : MESSAGES.modsUnknown}</strong>
        {' · '}{issue.moment === 'before' ? MESSAGES.modsPreviewBefore : MESSAGES.modsPreviewAfter}
        {' · '}{issue.scope === 'local' ? MESSAGES.modsDeclaration : 'Modrinth'}
        {' · '}{issue.fileId ? names([issue.fileId]) : MESSAGES.modsEnvironment}
        {' · '}{MOD_ISSUE_MESSAGES[issue.code] ?? MESSAGES.modsUnknownReason}
        {issue.modId && <> · {MESSAGES.modsPreviewIssueMod} <code>{issue.modId}</code></>}
        {issue.dependencyModId && <> · {MESSAGES.modsPreviewIssueDependency} <code>{issue.dependencyModId}</code></>}
        {issue.dependencyProjectId && <> · {MESSAGES.modsPreviewIssueProject} <code>{issue.dependencyProjectId}</code></>}
        {issue.dependencyVersionId && <> · {MESSAGES.modsPreviewIssueVersion} <code>{issue.dependencyVersionId}</code></>}
        {!issue.modId && !issue.dependencyModId && !issue.dependencyProjectId && !issue.dependencyVersionId && <> · <code>{issue.code}</code></>}
        {issue.requirement && <> · {MESSAGES.modsRequirement} {issue.requirement}</>}
        {!!issue.actual.length && <> · {MESSAGES.modsActual} {issue.actual.join(', ')}</>}
        {issue.embeddedDepth > 0 && <> · {MESSAGES.modsPreviewEmbeddedDepth} {issue.embeddedDepth}</>}</li>)}</ul>}
    </section>}
  </div>;
}
