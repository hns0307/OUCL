import { useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { firstRunStatus } from './first-run.js';
import type { FirstRunInput } from './first-run.js';

interface FirstRunGuideProps extends FirstRunInput {
  enabled: boolean;
  error: MessageKey | undefined;
  onOpenSettings(): void;
  onOpenAccounts(): void;
  onRetry(): Promise<void>;
}

/** Session-only, optional preparation guide. Existing controls own every persistent choice. */
export function FirstRunGuide({ enabled, error, onOpenSettings, onOpenAccounts, onRetry, ...input }: FirstRunGuideProps) {
  const status = firstRunStatus(input);
  const [dismissed, setDismissed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const expanded = opened || (!dismissed && !status.canContinue);
  async function retry(): Promise<void> {
    if (!enabled || busy) return;
    setBusy(true); setFailed(false);
    try { await onRetry(); } catch { setFailed(true); } finally { setBusy(false); }
  }
  function close(): void { setDismissed(true); setOpened(false); }
  if (!expanded) return <button className="text-button first-run-reopen" onClick={() => { setOpened(true); }}>{MESSAGES.firstRunReopen}</button>;
  return <section className="panel first-run-guide" aria-labelledby="first-run-title">
    <div className="section-heading"><h2 id="first-run-title">{MESSAGES.firstRunTitle}</h2><button className="text-button" onClick={close}>{MESSAGES.firstRunSkip}</button></div>
    <p className="muted small">{MESSAGES.firstRunHint}</p>
    {!status.loaded ? !error && <p role="status">{MESSAGES.firstRunLoading}</p> : <ol className="first-run-steps">
      <li><strong>{status.rootSelected ? MESSAGES.firstRunRootSelected : MESSAGES.firstRunRootMissing}</strong><button className="secondary" disabled={!enabled || busy} onClick={onOpenSettings}>{MESSAGES.firstRunOpenSettings}</button></li>
      <li><strong>{status.accountSelected ? MESSAGES.firstRunAccountSelected : MESSAGES.firstRunAccountMissing}</strong><button className="secondary" disabled={!enabled || busy} onClick={onOpenAccounts}>{MESSAGES.firstRunOpenAccounts}</button></li>
      <li><p>{status.javaRegistered ? MESSAGES.firstRunJavaRegistered : MESSAGES.firstRunJavaAutomatic}</p><button className="secondary" disabled={!enabled || busy} onClick={onOpenSettings}>{MESSAGES.firstRunOpenSettings}</button></li>
    </ol>}
    <div className="save-row"><button className="secondary" disabled={!enabled || busy} onClick={() => { void retry(); }}>{busy ? MESSAGES.connecting : MESSAGES.firstRunRetry}</button>
      {status.canContinue && <button onClick={close}>{MESSAGES.firstRunContinue}</button>}</div>
    {(failed || error) && <p className="form-error" role="alert">{MESSAGES[error ?? 'unavailable']}</p>}
  </section>;
}
