import { useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { useLauncher } from './launcher-state.js';

/** Account selection and creation share the real offline profile projection. */
export function AccountsPanel({ enabled }: { enabled: boolean }) {
  const { accounts, accountId, selectAccount, refreshProfiles } = useLauncher();
  const [expanded, setExpanded] = useState(false); const [nickname, setNickname] = useState(''); const [gameName, setGameName] = useState('');
  const [saving, setSaving] = useState(false); const [error, setError] = useState<MessageKey>(); const request = useRef<string | undefined>(undefined);
  async function create(): Promise<void> {
    if (!window.oucl || saving) return; setSaving(true); setError(undefined); request.current ??= crypto.randomUUID();
    try {
      const result = await window.oucl.createOfflineAccount(request.current, { displayName: nickname.trim(), gameName });
      if (result.ok) { await refreshProfiles(); selectAccount(result.data.account.accountId); request.current = undefined; setExpanded(false); setNickname(''); setGameName(''); }
      else { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') request.current = undefined; }
    } catch { setError('unavailable'); } finally { setSaving(false); }
  }
  return <div className="account-chooser"><label className="field-label">{MESSAGES.accountSelect}<select disabled={!enabled} aria-label={MESSAGES.accountSelect} value={accountId ?? ''} onChange={e => { selectAccount(e.target.value || undefined); }}>
    {!accounts.length && <option value="">{MESSAGES.accountEmpty}</option>}{accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.displayName} · {a.gameName}</option>)}
    </select></label><button className="text-button" disabled={!enabled} aria-expanded={expanded} onClick={() => { setExpanded(!expanded); }}>{MESSAGES.uiAddAccount}</button>
    {expanded && <form className="account-form" onSubmit={e => { e.preventDefault(); void create(); }}>
      <label>{MESSAGES.accountNickname}<input maxLength={80} value={nickname} onChange={e => { setNickname(e.target.value); request.current = undefined; }} /></label>
      <label>{MESSAGES.accountGameName}<input maxLength={16} value={gameName} onChange={e => { setGameName(e.target.value); request.current = undefined; }} /></label>
      <p className="muted small">{MESSAGES.offlineNotice}</p><button type="submit" disabled={saving || !nickname.trim() || !/^[A-Za-z0-9_]{3,16}$/.test(gameName)}>{saving ? MESSAGES.accountCreating : MESSAGES.accountCreate}</button>
    </form>}{error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
  </div>;
}
