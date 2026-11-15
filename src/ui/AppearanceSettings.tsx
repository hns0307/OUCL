import { useEffect, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { DEFAULT_APPEARANCE } from '../shared/contracts/desktop.js';
import type { Appearance, HomeCard } from '../shared/contracts/desktop.js';
import { useDesktop } from './desktop-state.js';

const TITLES = { banner: 'uiBannerCard', game: 'uiGameCard', community: 'uiCommunityCard' } as const;
/** Explicit save with live preview, original palettes and keyboard alternatives for every drag operation. */
export function AppearanceSettings() {
  const desktop = useDesktop(); const [value, setValue] = useState<Appearance>(desktop.snapshot.appearance); const [saved, setSaved] = useState(false); const [choosing, setChoosing] = useState(false);
  const [iconError, setIconError] = useState<MessageKey>();
  const blocked = !desktop.loaded || desktop.busy || choosing;
  useEffect(() => { setValue(desktop.preview ?? desktop.snapshot.appearance); }, [desktop.snapshot.appearance, desktop.preview]);
  function change(patch: Partial<Appearance>): void {
    if (blocked) return;
    const current = useDesktop.getState(); const next = { ...(current.preview ?? current.snapshot.appearance), ...patch };
    setValue(next); desktop.setPreview(next); setSaved(false); setIconError(undefined);
  }
  function cancel(): void { if (!blocked) { desktop.setPreview(undefined); setValue(desktop.snapshot.appearance); setSaved(false); setIconError(undefined); } }
  function move(card: HomeCard, to: number): void { const order = value.homeOrder.filter(id => id !== card); order.splice(Math.max(0, Math.min(to, order.length)), 0, card); change({ homeOrder: order }); }
  async function choose(): Promise<void> {
    if (!window.oucl || blocked) return; setChoosing(true); setIconError(undefined); setSaved(false);
    try {
      const result = await window.oucl.chooseDesktopIcon(crypto.randomUUID());
      if (!result.ok) { setIconError(result.error.messageKey); return; }
      if (result.data.icon) {
        const current = useDesktop.getState();
        // A sidebar save may have completed while the native picker was open; preserve that newer projection.
        if (!current.busy) { const next = { ...(current.preview ?? current.snapshot.appearance), icon: result.data.icon }; setValue(next); desktop.setPreview(next); }
      }
    } catch { setIconError('unavailable'); }
    finally { setChoosing(false); }
  }
  return <section className="panel appearance-settings" tabIndex={0} onKeyDown={event => {
    if (event.key === 'Escape' && event.target === event.currentTarget && desktop.preview && !blocked) { event.preventDefault(); cancel(); }
  }}><div className="section-heading"><h2>{MESSAGES.uiAppearance}</h2><span role="status" className="muted small">{desktop.busy ? MESSAGES.uiSaving : desktop.preview ? MESSAGES.uiPreviewPending : saved ? MESSAGES.uiSaved : ''}</span></div>
    <p className="muted small">{MESSAGES.uiAppearanceHint}</p><fieldset className="appearance-controls" aria-label={MESSAGES.uiAppearance} disabled={blocked}><div className="theme-presets">{[
      { accent: '#50765a', background: '#f6f8f4', surface: '#ffffff', ink: '#293c30' }, { accent: '#407da0', background: '#f1f6fa', surface: '#ffffff', ink: '#25384a' },
      { accent: '#b3a0df', background: '#1d202a', surface: '#292d39', ink: '#edf0f7' }, { accent: '#a47543', background: '#faf5ee', surface: '#fffdfa', ink: '#48382b' },
    ].map((palette, i) => <button key={palette.accent} className="palette-button" aria-label={`${MESSAGES.uiAccent} ${i + 1}`} style={{ background: palette.background, color: palette.accent, borderColor: palette.accent }} onClick={() => { change(palette); }}>● ● ●</button>)}</div>
    <div className="color-controls">{(['accent', 'background', 'surface', 'ink'] as const).map((key, i) => <label key={key}><span>{MESSAGES[(['uiAccent', 'uiBackground', 'uiSurface', 'uiTextColor'] as const)[i]!]}</span><input type="color" value={value[key]} onChange={event => { change({ [key]: event.target.value }); }} /></label>)}</div>
    <div className="appearance-icon-row">{value.icon && <img src={value.icon} alt="" className="custom-brand-preview" />}<button className="secondary" disabled={!desktop.loaded || choosing} onClick={() => { void choose(); }}>{MESSAGES.uiChooseIcon}</button><button className="text-button" onClick={() => { change({ icon: '' }); }}>{MESSAGES.uiClearIcon}</button></div><p className="muted small">{MESSAGES.uiIconHint}</p>
    <label className="setting-row"><strong>{MESSAGES.uiLayout}</strong><select value={value.layout} onChange={event => { change({ layout: event.target.value === 'profile-left' ? 'profile-left' : 'balanced' }); }}><option value="balanced">{MESSAGES.uiBalancedLayout}</option><option value="profile-left">{MESSAGES.uiProfileLeft}</option></select></label>
    <label className="setting-row"><strong>{MESSAGES.uiDensity}</strong><select value={value.density} onChange={event => { change({ density: event.target.value === 'compact' ? 'compact' : 'comfortable' }); }}><option value="comfortable">{MESSAGES.uiComfortable}</option><option value="compact">{MESSAGES.uiCompact}</option></select></label>
    <h3>{MESSAGES.uiHomeCards}</h3><p className="muted small">{MESSAGES.uiDragCards}</p><div className="home-card-order">{value.homeOrder.map((card, i) => <div key={card} className="layout-order-row" onDragOver={event => { if (event.dataTransfer.types.includes('application/x-oucl-home-card')) event.preventDefault(); }}
      onDrop={event => { const from = event.dataTransfer.getData('application/x-oucl-home-card'); if (!value.homeOrder.includes(from as HomeCard)) return; event.preventDefault(); move(from as HomeCard, i); }}>
      <button className="drag-grip secondary" draggable aria-label={`${MESSAGES.uiDragCards} ${MESSAGES[TITLES[card]]}`} onDragStart={event => { event.dataTransfer.setData('application/x-oucl-home-card', card); event.dataTransfer.effectAllowed = 'move'; }}>⠿</button>
      <strong>{MESSAGES[TITLES[card]]}</strong><label><input type="checkbox" aria-label={MESSAGES[TITLES[card]]} disabled={card === 'game'} checked={!value.homeHidden.includes(card)} onChange={event => { change({ homeHidden: event.target.checked ? value.homeHidden.filter(id => id !== card) : [...value.homeHidden, card] }); }} /></label>
      <button className="secondary" aria-label={`${MESSAGES.uiMoveUp} ${MESSAGES[TITLES[card]]}`} disabled={i === 0} onClick={() => { move(card, i - 1); }}>↑</button><button className="secondary" aria-label={`${MESSAGES.uiMoveDown} ${MESSAGES[TITLES[card]]}`} disabled={i === 2} onClick={() => { move(card, i + 1); }}>↓</button>
    </div>)}</div><div className="save-row"><button disabled={blocked || !desktop.preview} onClick={() => { void desktop.saveAppearance(value).then(setSaved); }}>{MESSAGES.uiSave}</button><button className="secondary" onClick={() => { change(structuredClone(DEFAULT_APPEARANCE)); }}>{MESSAGES.uiResetAppearance}</button><button className="text-button" disabled={!desktop.preview} onClick={cancel}>{MESSAGES.uiCancelEdit}</button></div></fieldset>
    {(iconError ?? desktop.error) && <p className="form-error" role="alert">{MESSAGES[(iconError ?? desktop.error)!]}</p>}
  </section>;
}
