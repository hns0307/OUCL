
import { useCallback, useEffect, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { OnlineAccountError, OnlineAccountsAction, OnlineAccountsSnapshot, OnlineAccountTextures } from '../shared/contracts/online-accounts.js';
import { useLauncher } from './launcher-state.js';

const ERRORS: Record<OnlineAccountError, MessageKey> = {
  INVALID_ARGUMENT: 'invalidArgument', INVALID_SENDER: 'invalidSender', UNSUPPORTED_CONTRACT: 'unsupportedContract',
  UNCONFIGURED: 'microsoftConfiguredMissing', CANCELLED: 'onlineAccountCancelled', BUSY: 'onlineAccountBusy',
  SIGN_IN: 'onlineAccountSignInFailed', REAUTH: 'onlineAccountReauth', NO_LICENSE: 'onlineAccountNoLicense',
  NO_PROFILE: 'onlineAccountNoProfile', ACCESS_DENIED: 'onlineAccountDenied', NETWORK: 'onlineAccountUnavailable',
  STORAGE: 'onlineAccountStorage', NOT_FOUND: 'chooseAccountFirst', TIMEOUT: 'timeout', UNAVAILABLE: 'unavailable',
};

export function OnlineAccountsPanel({ enabled, onOpenSkin, onUseAccount }: {
  enabled: boolean; onOpenSkin(): void; onUseAccount(): void;
}) {
  const refreshProfiles = useLauncher(state => state.refreshProfiles);
  const selectAccount = useLauncher(state => state.selectAccount);
  const accounts = useLauncher(state => state.accounts);
  const [view, setView] = useState<OnlineAccountsSnapshot>();
  const [textures, setTextures] = useState<OnlineAccountTextures>();
  const [pending, setPending] = useState<OnlineAccountsAction['kind']>();
  const [error, setError] = useState<MessageKey>();

  const read = useCallback(async (): Promise<void> => {
    const result = await window.oucl?.onlineAccounts({ kind: 'list' });
    if (result?.ok && result.data.kind === 'accounts') setView(result.data);
    else if (result && !result.ok) setError(ERRORS[result.error]);
  }, []);
  useEffect(() => {
    if (enabled) void read().catch(() => { setError('unavailable'); });
  }, [enabled, read]);

  async function request(action: OnlineAccountsAction): Promise<void> {
    if (!enabled || !window.oucl || (pending && action.kind !== 'cancelMicrosoft')) return;
    const cancel = action.kind === 'cancelMicrosoft';
    if (!cancel) setPending(action.kind);
    setError(undefined);
    try {
      const result = await window.oucl.onlineAccounts(action);
      if (!result.ok) { setError(ERRORS[result.error]); }
      else if (result.data.kind === 'accounts' && !cancel) {
        setView(result.data);
        if (action.kind !== 'list') setTextures(undefined);
      } else if (result.data.kind === 'textures') { setTextures(result.data); }
      if (action.kind !== 'textures' && !cancel) {
        await refreshProfiles();
        if (!result.ok) await read();
      }
    } catch { setError('unavailable'); }
    finally { if (!cancel) setPending(undefined); }
  }

  return <section className="panel online-accounts">
    <div className="section-heading"><h2>{MESSAGES.uiAccountCenter}</h2>
      <button className="secondary" onClick={onOpenSkin}>{MESSAGES.uiSkinCenter}</button>
    </div>
    {!enabled && <p className="muted">{MESSAGES.unavailable}</p>}
    {enabled && <>
      <div className="save-row">
        <button type="button" disabled={!view?.microsoftConfigured || pending !== undefined}
          onClick={() => { void request({ kind: 'beginMicrosoft' }); }}>{MESSAGES.microsoftSignIn}</button>
        {pending === 'beginMicrosoft' && <button type="button" className="secondary"
          onClick={() => { void request({ kind: 'cancelMicrosoft' }); }}>{MESSAGES.microsoftCancel}</button>}
      </div>
      {view && !view.microsoftConfigured && <p className="muted small">{MESSAGES.microsoftConfiguredMissing}</p>}
      {pending === 'beginMicrosoft' && <p role="status">{MESSAGES.microsoftWaiting}</p>}
      {pending === 'refreshMicrosoft' && <p role="status">{MESSAGES.microsoftRefreshing}</p>}
      <ul className="online-account-list">
        {[...accounts.filter(account => account.kind === 'offline'), ...(view?.items ?? [])].map(account => {
          const status = account.kind === 'microsoft'
            ? account.entitlement === 'reauth' ? MESSAGES.onlineAccountReauth : account.entitlement === 'none' ? MESSAGES.onlineAccountNoLicense
              : !account.uuid ? MESSAGES.onlineAccountNoProfile : account.entitlement === 'owned' ? MESSAGES.accountOwned : MESSAGES.accountPlayable
            : account.kind === 'offline' ? MESSAGES.uiOffline : MESSAGES.uiYggdrasil;
          return <li key={account.accountId}>
            <div><strong>{account.displayName}</strong><p className="small muted">{status}</p>
              {account.kind !== 'offline' && account.uuid && <small>{account.uuid}</small>}</div>
            <div className="save-row">
              {account.ready && <button className="secondary" disabled={pending !== undefined} onClick={() => {
                selectAccount(account.accountId); onUseAccount();
              }}>{MESSAGES.accountChoose}</button>}
              {account.kind === 'microsoft' && <>
                <button className="secondary" disabled={pending !== undefined || !view?.microsoftConfigured}
                  onClick={() => { void request({ kind: 'refreshMicrosoft', accountId: account.accountId }); }}>{MESSAGES.accountRefresh}</button>
                {account.uuid && <button className="secondary" disabled={pending !== undefined}
                  onClick={() => { void request({ kind: 'textures', accountId: account.accountId }); }}>{MESSAGES.accountTextures}</button>}
                <button className="secondary" disabled={pending !== undefined}
                  onClick={() => { void request({ kind: 'removeMicrosoft', accountId: account.accountId }); }}>{MESSAGES.accountSignOut}</button>
              </>}
            </div>
          </li>;
        })}
      </ul>
      {textures && <div className="online-account-textures">{textures.skin && <img src={textures.skin} alt={MESSAGES.accountSkinAlt} />}
        {textures.cape && <img src={textures.cape} alt={MESSAGES.accountCapeAlt} />}
        {!textures.skin && !textures.cape && <p role="status">{MESSAGES.accountNoTextures}</p>}</div>}
    </>}
    {error && <p role="alert" className="form-error">{MESSAGES[error]}</p>}
  </section>;
}
