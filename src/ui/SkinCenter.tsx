import { useEffect, useRef, useState } from 'react';
import { SKIN_MAX_PNG_BYTES } from '../shared/contracts/skin.js';
import type { SkinBridge, SkinChannel, SkinErrorCode, SkinLoginResult, SkinModel, SkinPreview, SkinProvider, SkinResult, SkinSnapshot } from '../shared/contracts/skin.js';
import { SKIN_ERRORS, SKIN_TEXT as T } from '../shared/locales/skin.js';
import type { SkinViewer } from 'skinview3d';

interface Draft { bytes: Uint8Array; image: string }
interface SkinCenterProps { bridge: SkinBridge; onAccountsChanged: () => void; draftPng?: Uint8Array }
const EMPTY: SkinSnapshot = { providers: [], accounts: [] };

function previewPng(bytes: Uint8Array): Promise<Draft> {
  if (bytes.length > SKIN_MAX_PNG_BYTES || bytes.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
    return Promise.reject(new Error('INVALID_TEXTURE'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('INVALID_TEXTURE'));
    reader.onload = () => typeof reader.result === 'string' ? resolve({ bytes, image: reader.result }) : reject(new Error('INVALID_TEXTURE'));
    reader.readAsDataURL(new Blob([new Uint8Array(bytes).buffer], { type: 'image/png' }));
  });
}

function PlayerPreview({ preview, draft, model }: { preview: SkinPreview | undefined; draft: Draft | undefined; model: SkinModel }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const skin = draft?.image ?? preview?.skin;
  const cape = preview?.cape;
  const modelType = draft ? model : preview?.model ?? 'default';
  useEffect(() => {
    let mounted = true; let viewer: SkinViewer | undefined;
    setStatus('loading');
    if (skin || cape) void (async () => {
      try {
        const { SkinViewer: Viewer } = await import('skinview3d');
        if (!mounted || !canvas.current) return;
        viewer = new Viewer({ canvas: canvas.current, width: 270, height: 260, zoom: 0.9 });
        viewer.controls.enablePan = false;
        await Promise.all([
          skin ? viewer.loadSkin(skin, { model: modelType }) : undefined,
          cape ? viewer.loadCape(cape) : undefined,
        ]);
        if (mounted) setStatus('ready');
      } catch { if (mounted) setStatus('failed'); viewer?.dispose(); viewer = undefined; }
    })();
    return () => { mounted = false; viewer?.dispose(); };
  }, [skin, cape, modelType]);
  if (!skin && !cape) return <p className="muted">{T.emptyPreview}</p>;
  return <>
    <canvas ref={canvas} aria-label={T.rolePreview} hidden={status === 'failed'} />
    {status === 'failed' && <><p className="muted">{skin ? T.enableWebGl : T.enableWebGlEmpty}</p>
      {skin && <img src={skin} width={128} height={128} alt={T.localPreview} />}</>}
  </>;
}

/** Shows native provider discovery, role selection, signed texture preview, and explicit upload. */
export function SkinCenter({ bridge, onAccountsChanged, draftPng }: SkinCenterProps) {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [providerId, setProviderId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [url, setUrl] = useState('');
  const [proposal, setProposal] = useState<{ discoveryId: string; provider: SkinProvider }>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [choose, setChoose] = useState<Extract<SkinLoginResult, { state: 'select' }>>();
  const [selectedRole, setSelectedRole] = useState('');
  const [preview, setPreview] = useState<{ accountId: string; view: SkinPreview }>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [model, setModel] = useState<SkinModel>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SkinErrorCode>();
  const [previewError, setPreviewError] = useState<SkinErrorCode>();
  const [notice, setNotice] = useState('');
  const provider = snapshot.providers.find(item => item.providerId === providerId) ?? snapshot.providers[0];
  const accounts = snapshot.accounts.filter(item => item.providerId === provider?.providerId);
  const account = accounts.find(item => item.accountId === accountId) ?? accounts[0];
  const currentAccountId = account?.accountId;
  const view = preview?.accountId === currentAccountId ? preview?.view : undefined;

  useEffect(() => {
    let current = true;
    void bridge.skinList().then(result => {
      if (!current) return;
      if (result.ok) setSnapshot(result.data); else setError(result.error.code);
    }).catch(() => { if (current) setError('UNAVAILABLE'); });
    return () => { current = false; };
  }, [bridge]);
  useEffect(() => {
    if (!draftPng) return;
    let current = true;
    void previewPng(draftPng).then(value => { if (current) setDraft(value); }, () => { if (current) setError('INVALID_TEXTURE'); });
    return () => { current = false; };
  }, [draftPng]);
  useEffect(() => {
    if (!currentAccountId) return;
    let current = true;
    setPreviewError(undefined);
    void bridge.skinPreview(currentAccountId).then(result => {
      if (!current) return;
      if (result.ok) setPreview({ accountId: currentAccountId, view: result.data }); else setPreviewError(result.error.code);
    }).catch(() => { if (current) setPreviewError('UNAVAILABLE'); });
    return () => { current = false; };
  }, [bridge, currentAccountId]);

  async function action<C extends SkinChannel,>(run: () => Promise<SkinResult<C>>, accept: (data: Extract<SkinResult<C>, { ok: true }>['data']) => void | Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true); setError(undefined); setNotice('');
    try {
      const result = await run();
      if (result.ok) await accept(result.data); else setError(result.error.code);
    } catch { setError('UNAVAILABLE'); }
    finally { setBusy(false); }
  }
  async function refresh(accountsChanged = false): Promise<void> {
    const result = await bridge.skinList();
    if (result.ok) setSnapshot(result.data); else setError(result.error.code);
    if (accountsChanged) onAccountsChanged();
  }
  async function pick(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(undefined); setNotice('');
    try {
      if (file.size > SKIN_MAX_PNG_BYTES) throw new Error('INVALID_TEXTURE');
      setDraft(await previewPng(new Uint8Array(await file.arrayBuffer())));
    } catch { setError('INVALID_TEXTURE'); }
  }
  async function refreshPreview(): Promise<void> {
    if (!currentAccountId) return;
    setPreviewError(undefined);
    await action<'skin:preview'>(() => bridge.skinPreview(currentAccountId), data => setPreview({ accountId: currentAccountId, view: data }));
  }

  return <section className="settings-grid" aria-label={T.title}>
    <div className="card">
      <div className="section-heading"><h2>{T.providers}</h2></div>
      <form className="account-form" onSubmit={event => {
        event.preventDefault();
        void action<'skin:discover'>(() => bridge.skinDiscover(url), setProposal);
      }}>
        <label>{T.siteUrl}<input value={url} onChange={event => { setUrl(event.target.value); setProposal(undefined); }} maxLength={2048} placeholder="https://skin.example.org" disabled={busy} /></label>
        <button disabled={busy || !url.trim()} type="submit">{T.discover}</button>
      </form>
      {proposal && <div className="registered-root">
        <strong>{proposal.provider.name}</strong>
        <span>{T.providerType} · {proposal.provider.adapter === 'blessing' ? 'Blessing Skin' : 'Yggdrasil'}</span>
        <span>{T.api} · {proposal.provider.apiRoot}</span>
        <button disabled={busy} onClick={() => { void action<'skin:addProvider'>(() => bridge.skinAddProvider(proposal.discoveryId), async added => {
          setProviderId(added.providerId); setProposal(undefined); setUrl(''); await refresh();
        }); }}>{T.addProvider}</button>
      </div>}
      {provider ? <div className="registered-root">
        <label>{T.providers}<select value={provider.providerId} disabled={busy || !!choose} onChange={event => {
          setProviderId(event.target.value); setAccountId(''); setUsername(''); setPassword(''); setConfirmRemove(false);
        }}>{snapshot.providers.map(item => <option key={item.providerId} value={item.providerId}>{item.name}</option>)}</select></label>
        <span>{T.api} · {provider.apiRoot}</span>
        <button disabled={busy} onClick={() => { void action<'skin:openSite'>(() => bridge.skinOpenSite(provider.providerId), () => {}); }}>{T.open}</button>
        <button disabled={busy || !!choose} onClick={() => setConfirmRemove(!confirmRemove)}>{T.remove}</button>
        {confirmRemove && <><p>{T.removeConfirm}</p><button disabled={busy} onClick={() => {
          void action<'skin:removeProvider'>(() => bridge.skinRemoveProvider(provider.providerId), async () => {
            setConfirmRemove(false); setProviderId(''); setAccountId(''); await refresh(true);
          });
        }}>{T.confirm}</button></>}
      </div> : <p className="muted">{T.noProvider}</p>}
      {provider && <div>
        <div className="section-heading"><h2>{T.login}</h2></div>
        {choose ? <form className="account-form" onSubmit={event => {
          event.preventDefault();
          void action<'skin:selectRole'>(() => bridge.skinSelectRole(choose.loginId, selectedRole), async chosen => {
            setChoose(undefined); setUsername(''); setAccountId(chosen.accountId); await refresh(true);
          });
        }}>
          <label>{T.chooseRole}<select value={selectedRole} disabled={busy} onChange={event => setSelectedRole(event.target.value)}>
            {choose.roles.map(role => <option key={role.uuid} value={role.uuid}>{role.gameName}</option>)}</select></label>
          <button disabled={busy || !selectedRole} type="submit">{T.activateRole}</button>
          <button disabled={busy} type="button" onClick={() => {
            void action<'skin:cancelLogin'>(() => bridge.skinCancelLogin(choose.loginId), () => { setChoose(undefined); setSelectedRole(''); });
          }}>{T.cancel}</button>
        </form> : <form className="account-form" onSubmit={event => {
          event.preventDefault();
          const input = { providerId: provider.providerId, username: username.trim(), password };
          setPassword('');
          void action<'skin:login'>(() => bridge.skinLogin(input), async result => {
            if (result.state === 'select') { setChoose(result); setSelectedRole(result.roles[0]?.uuid ?? ''); }
            else { setUsername(''); setAccountId(result.account.accountId); await refresh(true); }
          });
        }}>
          <label>{provider.loginByName ? T.usernameOrRole : T.username}<input value={username} maxLength={254} autoComplete="username" disabled={busy} onChange={event => setUsername(event.target.value)} /></label>
          <label>{T.password}<input type="password" value={password} maxLength={1024} autoComplete="current-password" disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
          <button type="submit" disabled={busy || !username.trim() || !password}>{T.signin}</button>
        </form>}
      </div>}
    </div>
    <div className="card">
      <div className="section-heading"><h2>{T.rolePreview}</h2></div>
      {account ? <div className="account-form">
        <label>{T.role}<select value={account.accountId} disabled={busy} onChange={event => setAccountId(event.target.value)}>
          {accounts.map(item => <option key={item.accountId} value={item.accountId}>{item.gameName}{item.ready ? '' : ' · ' + T.loggedOut}</option>)}</select></label>
        <p>UUID · {account.uuid}</p>
        <button disabled={busy || !account.ready} onClick={() => {
          void action<'skin:logout'>(() => bridge.skinLogout(account.accountId), async result => {
            await refresh(true); setNotice(result.revoked ? T.loggedOut : T.revokeUnknown);
          });
        }}>{T.logout}</button>
      </div> : <p className="muted">{T.noRole}</p>}
      <PlayerPreview preview={view} draft={draft} model={model} />
      {previewError && <p className="form-error" role="status">{SKIN_ERRORS[previewError]}</p>}
      {account && <button className="text-button" disabled={busy} onClick={() => { void refreshPreview(); }}>{T.uploadRetry}</button>}
      <div className="account-form">
        <label>{T.chooseFile}<input type="file" accept="image/png,.png" disabled={busy} onChange={event => {
          void pick(event.currentTarget.files?.[0]); event.currentTarget.value = '';
        }} /></label>
        {draft && <>
          <label>{T.model}<select value={model} disabled={busy} onChange={event => setModel(event.target.value === 'slim' ? 'slim' : 'default')}>
            <option value="default">Steve</option><option value="slim">Alex</option>
          </select></label>
          <p className="muted">{account?.ready && view?.uploadSkin ? T.draftOnly : T.chooseSignedIn}</p>
          <div><button className="primary" disabled={busy || !account?.ready || !view?.uploadSkin} onClick={() => {
            if (!account) return;
            void action<'skin:upload'>(() => bridge.skinUpload({ accountId: account.accountId, model, png: draft.bytes }), data => {
              setPreview(data.preview ? { accountId: account.accountId, view: data.preview } : undefined);
              setPreviewError(undefined); setDraft(undefined); setNotice(data.preview ? T.uploaded : T.uploadedPreviewPending);
            });
          }}>{T.remotelyApplied}</button> <button disabled={busy} onClick={() => setDraft(undefined)}>{T.cancel}</button></div>
        </>}
      </div>
      {busy && <p role="status">{T.loading}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{SKIN_ERRORS[error]}</p>}
    </div>
  </section>;
}
