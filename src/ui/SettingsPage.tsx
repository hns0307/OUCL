import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { RootSettings } from './RootSettings.js';
import { useLauncher } from './launcher-state.js';
import { DownloadSettings } from './DownloadSettings.js';

/** Saves real launch preferences and native Java selections with conflict recovery. */
export function SettingsPage({ enabled, rootsEnabled, downloadsEnabled }: { enabled: boolean; rootsEnabled: boolean; downloadsEnabled: boolean }) {
  const { settings, refreshSettings, setRoot } = useLauncher();
  const [memory, setMemory] = useState(2048); const [isolation, setIsolation] = useState(true); const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false); const [choosing, setChoosing] = useState(false); const [saved, setSaved] = useState(false);
  const [error, setError] = useState<MessageKey>(); const request = useRef<string | undefined>(undefined);
  useEffect(() => { if (settings) { setMemory(settings.memoryMiB); setIsolation(settings.isolationDefault); setRevision(settings.revision); } }, [settings]);
  async function save(): Promise<void> {
    if (!window.oucl || saving) return; setSaving(true); setSaved(false); setError(undefined);
    try { const result = await window.oucl.updateSettings(crypto.randomUUID(), { expectedRevision: revision, patch: { memoryMiB: memory, isolationDefault: isolation } });
      if (result.ok) { await refreshSettings(); setSaved(true); } else { setError(result.error.messageKey); if (['REVISION_CONFLICT', 'TIMEOUT'].includes(result.error.code)) await refreshSettings(); }
    } catch { setError('unavailable'); } finally { setSaving(false); }
  }
  async function choose(): Promise<void> {
    if (!window.oucl || choosing) return; setChoosing(true); setError(undefined); request.current ??= crypto.randomUUID();
    try { const result = await window.oucl.chooseJava(request.current); if (result.ok) { request.current = undefined; await refreshSettings(); } else { setError(result.error.messageKey); if (result.error.code !== 'TIMEOUT') request.current = undefined; } }
    catch { setError('unavailable'); } finally { setChoosing(false); }
  }
  return <div className="settings-grid"><RootSettings enabled={rootsEnabled} onRootChange={setRoot} />
    <section className="panel"><div className="section-heading"><span className="section-number">02</span><h2>{MESSAGES.javaTitle}</h2></div>
      <p data-java-ready={Boolean(settings?.javaId)}>{settings?.javaId ? MESSAGES.javaConfigured : MESSAGES.javaNotConfigured}</p><p className="muted">{MESSAGES.uiJavaHint}</p>
      <button disabled={!enabled || choosing} onClick={() => { void choose(); }}>{choosing ? MESSAGES.javaChoosing : MESSAGES.javaChoose}</button></section>
    <section className="panel settings-launch"><div className="section-heading"><span className="section-number">03</span><h2>{MESSAGES.uiLaunchSettings}</h2></div>
      <label className="setting-row"><span><strong>{MESSAGES.uiMemory}</strong><small>{MESSAGES.uiMemoryHint}</small></span><input aria-label={MESSAGES.uiMemory} type="number" min={512} max={65536} step={1} value={Number.isNaN(memory) ? '' : memory} onChange={e => { setMemory(e.target.valueAsNumber); setSaved(false); }} /></label>
      <div className="memory-presets">{[2048, 4096, 8192].map(n => <button className="chip" key={n} onClick={() => { setMemory(n); setSaved(false); }}>{n / 1024} GiB</button>)}</div>
      <label className="setting-row"><span><strong>{MESSAGES.uiDefaultIsolation}</strong><small>{MESSAGES.uiIsolationHint}</small></span><input type="checkbox" checked={isolation} onChange={e => { setIsolation(e.target.checked); setSaved(false); }} /></label>
      <div className="save-row"><button disabled={!enabled || !settings || saving || !Number.isSafeInteger(memory) || memory < 512 || memory > 65536} onClick={() => { void save(); }}>{saving ? MESSAGES.uiSaving : MESSAGES.uiSave}</button><span role="status" className="success">{saved ? MESSAGES.uiSaved : ''}</span></div>
    </section><section className="panel"><div className="section-heading"><span className="section-number">04</span><h2>{MESSAGES.uiAbout}</h2></div><p>{MESSAGES.uiVersion}</p><p className="muted">{MESSAGES.uiAboutDescription}</p><p className="muted small">{MESSAGES.gameKeepAlive}</p></section>
    <DownloadSettings enabled={downloadsEnabled} />
    {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
  </div>;
}
