import { useEffect, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { DEFAULT_DOWNLOAD_PREFERENCES, isDownloadPreferences } from '../shared/contracts/download-preferences.js';
import type { DownloadPreferences } from '../shared/contracts/download-preferences.js';
import { useLauncher } from './launcher-state.js';

/** Edits only fixed download options; concurrent launch-setting edits use the same CAS revision. */
export function DownloadSettings({ enabled }: { enabled: boolean }) {
  const { settings, refreshSettings } = useLauncher();
  const [preferences, setPreferences] = useState<DownloadPreferences>({ ...DEFAULT_DOWNLOAD_PREFERENCES });
  const [revision, setRevision] = useState<number>(); const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false); const [error, setError] = useState<MessageKey>();
  useEffect(() => {
    let active = true;
    if (enabled && window.oucl) void window.oucl.getDownloadSettings().then(result => {
      if (!active) return;
      if (result.ok) { const { revision: next, ...data } = result.data; setPreferences(data); setRevision(next); }
      else setError(result.error.messageKey);
    }).catch(() => { if (active) setError('unavailable'); });
    return () => { active = false; };
  }, [enabled, settings?.revision]);
  async function save(): Promise<void> {
    if (!window.oucl || busy || revision === undefined || !isDownloadPreferences(preferences)) return;
    setBusy(true); setSaved(false); setError(undefined);
    try {
      const result = await window.oucl.updateDownloadSettings(crypto.randomUUID(), { expectedRevision: revision, preferences });
      if (result.ok) { setRevision(result.data.revision); setSaved(true); }
      else { setError(result.error.messageKey); const actual = await window.oucl.getDownloadSettings();
        if (actual.ok) { const { revision: next, ...data } = actual.data; setRevision(next); setPreferences(data); } }
      await refreshSettings();
    } catch { setError('unavailable'); } finally { setBusy(false); }
  }
  function update(patch: Partial<DownloadPreferences>): void { setPreferences(value => ({ ...value, ...patch })); setSaved(false); }
  return <section className="panel settings-launch download-settings"><h2>{MESSAGES.downloadSettings}</h2>
    <label className="setting-row"><strong>{MESSAGES.downloadSource}</strong><select aria-label={MESSAGES.downloadSource} disabled={!enabled || busy}
      value={preferences.source} onChange={event => update({ source: event.target.value === 'bmclapi' ? 'bmclapi' : 'official' })}>
      <option value="official">{MESSAGES.downloadOfficial}</option><option value="bmclapi">{MESSAGES.downloadMirror}</option></select></label>
    <p className="muted small">{MESSAGES.downloadAttribution}</p>
    {(['fileConcurrency', 'connectionsPerFile'] as const).map(key => <label className="setting-row" key={key}>
      <strong>{key === 'fileConcurrency' ? MESSAGES.downloadFileConcurrency : MESSAGES.downloadConnections}</strong>
      <input aria-label={key === 'fileConcurrency' ? MESSAGES.downloadFileConcurrency : MESSAGES.downloadConnections} type="number" min={1} max={8} step={1}
        disabled={!enabled || busy} value={Number.isNaN(preferences[key]) ? '' : preferences[key]} onChange={event => update({ [key]: event.target.valueAsNumber })} /></label>)}
    <p className="muted small">{MESSAGES.downloadConcurrencyHint}</p><p className="muted small">{MESSAGES.downloadRangeHint}</p>
    <div className="save-row"><button disabled={!enabled || revision === undefined || busy || !isDownloadPreferences(preferences)} onClick={() => { void save(); }}>{busy ? MESSAGES.uiSaving : MESSAGES.uiSave}</button>
      <span role="status" className="success">{saved ? MESSAGES.uiSaved : ''}</span></div>
    {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
  </section>;
}
