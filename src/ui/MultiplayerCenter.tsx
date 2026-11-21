import { useEffect, useState } from 'react';
import type { MultiplayerInput, MultiplayerSnapshot, RoomCode } from '../shared/contracts/multiplayer.js';
import { isInviteText, isPort, isRelay } from '../shared/contracts/multiplayer.js';
import { MULTIPLAYER_MESSAGES as copy } from '../shared/locales/multiplayer-messages.js';

interface Props {
  enabled: boolean;
  instanceNames?: Readonly<Record<string, string>>;
}
const EMPTY_RELAY = { address: '', publicKey: '', stun: '' };

function readRoom(input: MultiplayerInput) {
  if (!window.oucl) throw new Error('UNAVAILABLE');
  return window.oucl.multiplayer(input);
}

/** Presents live Minecraft room state and separate authenticated setup actions. */
export function MultiplayerCenter({ enabled, instanceNames }: Props) {
  const [state, setState] = useState<MultiplayerSnapshot>();
  const [error, setError] = useState<RoomCode>();
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [port, setPort] = useState('');
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState('');
  const [copied, setCopied] = useState(false);
  const [relay, setRelay] = useState(EMPTY_RELAY);

  useEffect(() => {
    if (!enabled || !window.oucl) return;
    let obsolete = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initial = true;
    async function refresh(): Promise<void> {
      try {
        const result = await readRoom({ action: 'snapshot' });
        if (!obsolete && result.ok) {
          setState(result.data);
          if (initial) setRelay(result.data.relay ?? EMPTY_RELAY);
          initial = false;
          if (!result.data.room || result.data.room.phase === 'failed') {
            setInvite('');
            setCopied(false);
          }
        } else if (!obsolete && initial && !result.ok) {
          setError(result.error.code);
        }
      } catch {
        if (!obsolete && initial) setError('UNAVAILABLE');
      }
      if (!obsolete) timer = setTimeout(() => { void refresh(); }, 1200);
    }
    void refresh();
    return () => { obsolete = true; clearTimeout(timer); };
  }, [enabled]);

  async function perform(input: MultiplayerInput): Promise<void> {
    if (!enabled || busy || !window.oucl) return;
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      const result = await readRoom(input);
      if (result.ok) {
        setState(result.data);
        if (result.invite) setInvite(result.invite);
        if (input.action === 'configure') setRelay(result.data.relay ?? EMPTY_RELAY);
        if (input.action === 'join') setCode('');
        if (input.action === 'leave') setInvite('');
      } else if (result.error.code !== 'CANCELLED') {
        setError(result.error.code);
      }
    } catch {
      setError('UNAVAILABLE');
    } finally {
      setBusy(false);
    }
  }

  const room = state?.room;
  const active = !!room && room.phase !== 'failed';
  const game = state?.games.find(item => item.sessionId === sessionId);
  const enteredPort = Number(port);
  const validPort = port === '' || /^\d{1,5}$/.test(port) && isPort(enteredPort);
  const usable = enabled && !!state?.supported && !!state.engineInstalled && !busy && !active;
  const route = room?.localPort ? '127.0.0.1:' + room.localPort.toString() : '';
  const settings = { address: relay.address.trim(), publicKey: relay.publicKey.trim(), stun: relay.stun.trim() };

  return <section className="panel">
    <h2>{copy.title}</h2>
    {error && <p role="alert">{copy.errors[error]}</p>}
    {state && !state.supported && <p role="status">{copy.platformUnavailable}</p>}
    {state?.supported && <div>
      <p>{state.engineInstalled ? copy.engineReady : copy.engineMissing}</p>
      <button disabled={busy || active} onClick={() => { void perform({ action: 'importEngine' }); }}>{copy.engineImport}</button>
    </div>}
    {room && <section>
      <h3>{room.role === 'host' ? copy.roleHost : copy.roleGuest}</h3>
      <p role="status">{copy.phases[room.phase]}{room.transport !== 'unknown' && ' · ' + copy.transports[room.transport]}</p>
      {room.problem && <p role="alert">{copy.errors[room.problem]}</p>}
      {room.gamePort && <p>{copy.detectedPort} {room.gamePort}</p>}
      {route && <div><p>{copy.pasteAddress}</p><output>{route}</output>{' '}
        <button onClick={() => { void navigator.clipboard.writeText(route).then(() => setCopied(true), () => setError('UNAVAILABLE')); }}>
          {copied ? copy.copied : copy.copy}
        </button></div>}
      {room.members.length > 1
        ? <ul aria-label={copy.members}>{room.members.map(member => <li key={member.id}>{member.host ? copy.roleHost : copy.roleGuest} {member.id.toString(16).slice(-4)}</li>)}</ul>
        : active && <p>{copy.waitingMembers}</p>}
      {active && room.role === 'host' && room.phase !== 'starting' && <button disabled={busy} onClick={() => { void perform({ action: 'invite' }); }}>{copy.copyInvite}</button>}
      {invite && active && <div><label>{copy.inviteHint}<textarea readOnly value={invite} rows={3} /></label>
        <button onClick={() => { void navigator.clipboard.writeText(invite).then(() => setCopied(true), () => setError('UNAVAILABLE')); }}>
          {copied ? copy.copied : copy.copy}
        </button></div>}
      <button disabled={busy} onClick={() => { void perform({ action: 'leave' }); }}>{room.role === 'host' ? copy.hostClose : copy.guestLeave}</button>
    </section>}
    <section>
      <h3>{copy.hostHeading}</h3>
      <p>{copy.hostHint}</p>
      <label>{copy.sessionPicker}<select value={sessionId} disabled={!usable} onChange={event => {
        setSessionId(event.currentTarget.value);
        setPort('');
      }}>
        <option value="">{copy.selectGame}</option>
        {state?.games.map(item => <option value={item.sessionId} key={item.sessionId}>{instanceNames?.[item.instanceId] ?? item.instanceId.slice(0, 8)}</option>)}
      </select></label>
      {game?.detectedPort && <p>{copy.detectedPort} {game.detectedPort}</p>}
      <label>{copy.manualPort}
        <input disabled={!usable} inputMode="numeric" maxLength={5} value={port} onChange={event => setPort(event.currentTarget.value)} />
      </label>
      <button disabled={!usable || !game || !validPort || port === '' && !game.detectedPort} onClick={() => {
        void perform({ action: 'host', sessionId, ...(port === '' ? {} : { port: enteredPort }) });
      }}>{copy.create}</button>
    </section>
    <section>
      <h3>{copy.joinHeading}</h3>
      <label>{copy.inviteInput}<textarea disabled={!usable} value={code} onChange={event => setCode(event.currentTarget.value)} rows={3} maxLength={1024} /></label>
      <button disabled={!usable || !isInviteText(code.trim())} onClick={() => { void perform({ action: 'join', invite: code.trim() }); }}>{copy.join}</button>
    </section>
    <details>
      <summary>{copy.settingsHeading}</summary>
      <p>{copy.settingsHint}</p>
      <label>{copy.relayAddress}<input disabled={!enabled || busy || active} value={relay.address} placeholder="tcp://relay.example.net:11010" maxLength={270}
        onChange={event => setRelay(value => ({ ...value, address: event.currentTarget.value }))} /></label>
      <label>{copy.relayPin}<input disabled={!enabled || busy || active} value={relay.publicKey} maxLength={44}
        onChange={event => setRelay(value => ({ ...value, publicKey: event.currentTarget.value }))} /></label>
      <label>{copy.stunAddress}<input disabled={!enabled || busy || active} value={relay.stun} placeholder="stun.example.net:3478" maxLength={260}
        onChange={event => setRelay(value => ({ ...value, stun: event.currentTarget.value }))} /></label>
      <button disabled={!enabled || busy || active || !isRelay(settings)} onClick={() => { void perform({ action: 'configure', relay: settings }); }}>{copy.relaySave}</button>
      <button disabled={!enabled || busy || active || !state?.relay} onClick={() => { void perform({ action: 'configure', relay: null }); }}>{copy.relayClear}</button>
    </details>
  </section>;
}
