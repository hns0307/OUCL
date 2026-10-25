import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { AccountSummary } from '../shared/contracts/profiles.js';

/** Profile setup consumes path-free public DTOs; native Java selection stays in the main process. */
export function ProfileSetup({ enabled, onAccount }: { enabled: boolean; onAccount: (id: string | undefined) => void }) {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]); const [selected, setSelected] = useState('');
  const [nickname, setNickname] = useState(''); const [gameName, setGameName] = useState('');
  const [javaReady, setJavaReady] = useState(false); const [choosing, setChoosing] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey>(); const javaRequest = useRef<string | undefined>(undefined); const accountRequest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !window.oucl) return; let active = true;
    void Promise.all([window.oucl.listAccounts(), window.oucl.getSettings()]).then(([listed, settings]) => {
      if (!active) return;
      if (listed.ok) { setAccounts(listed.data.items); const first = listed.data.items[0]?.accountId; setSelected(first ?? ''); onAccount(first); } else setError(listed.error.messageKey);
      if (settings.ok) setJavaReady(Boolean(settings.data.javaId)); else setError(settings.error.messageKey);
    }).catch(() => { if (active) setError('unavailable'); });
    return () => { active = false; };
  }, [enabled, onAccount]);
  async function choose(): Promise<void> {
    if (!window.oucl || choosing) return; setChoosing(true); setError(undefined); javaRequest.current ??= crypto.randomUUID();
    try {
      const result = await window.oucl.chooseJava(javaRequest.current);
      if (result.ok) { if (result.data.selection === 'chosen') setJavaReady(true); javaRequest.current = undefined; }
      else { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') javaRequest.current = undefined; }
    } catch { setError('unavailable'); } finally { setChoosing(false); }
  }
  async function create(): Promise<void> {
    if (!window.oucl || saving) return; setSaving(true); setError(undefined); accountRequest.current ??= crypto.randomUUID();
    try {
      const result = await window.oucl.createOfflineAccount(accountRequest.current, { displayName: nickname.trim(), gameName });
      if (result.ok) { const account = result.data.account; setAccounts(items => [...items.filter(item => item.accountId !== account.accountId), account]); setSelected(account.accountId); onAccount(account.accountId); accountRequest.current = undefined; }
      else { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') accountRequest.current = undefined; }
    } catch { setError('unavailable'); } finally { setSaving(false); }
  }
  if (!enabled) return null;
  return <div className="profile-layout">
    <section className="profile-card"><h2>{MESSAGES.javaTitle}</h2><p data-java-ready={javaReady}>{javaReady ? MESSAGES.javaConfigured : MESSAGES.javaNotConfigured}</p><button disabled={choosing} onClick={() => { void choose(); }}>{choosing ? MESSAGES.javaChoosing : MESSAGES.javaChoose}</button></section>
    <section className="profile-card"><h2>{MESSAGES.accountsTitle}</h2><p className="storage-note">{MESSAGES.offlineNotice}</p>
      <select aria-label={MESSAGES.accountSelect} value={selected} onChange={event => { setSelected(event.target.value); onAccount(event.target.value || undefined); }}>
        {accounts.length === 0 && <option value="">{MESSAGES.accountEmpty}</option>}{accounts.map(account => <option key={account.accountId} value={account.accountId}>{account.displayName} · {account.gameName}</option>)}
      </select>
      <div className="account-inputs"><label>{MESSAGES.accountNickname}<input maxLength={80} value={nickname} onChange={event => { setNickname(event.target.value); accountRequest.current = undefined; }} /></label>
        <label>{MESSAGES.accountGameName}<input maxLength={16} value={gameName} onChange={event => { setGameName(event.target.value); accountRequest.current = undefined; }} /></label></div>
      <button disabled={saving || !nickname.trim() || !/^[A-Za-z0-9_]{3,16}$/.test(gameName)} onClick={() => { void create(); }}>{saving ? MESSAGES.accountCreating : MESSAGES.accountCreate}</button>
    </section>{error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
  </div>;
}
