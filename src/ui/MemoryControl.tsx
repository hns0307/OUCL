import { MESSAGES } from '../shared/locales/messages.js';

/** Synchronized pointer/keyboard slider and exact MiB entry; the service retains final capacity validation. */
export function MemoryControl({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(value: number): void }) {
  const maximum = Number.isFinite(value) && value > 16384 ? 65536 : 16384;
  const sliderValue = Number.isFinite(value) ? Math.min(maximum, Math.max(512, value)) : 2048;
  return <div className="memory-control">
    <label className="setting-row"><span><strong>{MESSAGES.uiMemory}</strong><small>{MESSAGES.uiMemoryHint}</small></span>
      <span className="memory-exact"><input aria-label={MESSAGES.uiMemory} disabled={disabled} type="number" min={512} max={65536} step={1}
        value={Number.isNaN(value) ? '' : value} onChange={event => { onChange(event.target.valueAsNumber); }} /><span>MiB</span></span>
    </label>
    <label className="memory-slider-label"><span>{MESSAGES.uiMemorySlider}</span><output>{Number.isFinite(value) ? `${(value / 1024).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB` : '—'}</output>
      <input type="range" aria-label={MESSAGES.uiMemorySlider} min={512} max={maximum} step={128} value={sliderValue} disabled={disabled}
        onChange={event => { onChange(event.target.valueAsNumber); }} />
    </label><div className="memory-scale" aria-hidden="true"><span>512 MiB</span><span>{maximum / 1024} GiB</span></div>
    <div className="memory-presets">{[2048, 4096, 8192].map(n => <button className="chip" disabled={disabled} key={n} onClick={() => { onChange(n); }}>{n / 1024} GiB</button>)}</div>
  </div>;
}
