import { useId, useRef, useState } from 'react';
import { createGradientText } from '../shared/tools/gradient.js';
import { MESSAGES } from '../shared/locales/messages.js';

// Fixed local tools only: this registry never loads scripts or grants system access.
const TOOLS = [{ id: 'gradient', label: 'toolboxTitle' }] as const;

/** Local text editing and selectable JSON output; no IO, persistence or clipboard permission. */
export function Toolbox() {
  const id = useId(); const output = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('OUCL'); const [start, setStart] = useState('#22c55e'); const [end, setEnd] = useState('#3b82f6');
  const result = createGradientText(text, start, end);
  const errors = { empty: 'toolboxEmpty', tooLong: 'toolboxTooLong', invalidColor: 'toolboxInvalidColor', invalidText: 'toolboxInvalidText' } as const;
  return <section className="panel toolbox-panel" aria-labelledby={`${id}-title`}>
    <div className="section-heading"><h2 id={`${id}-title`}>{MESSAGES.uiToolbox}</h2><span className="tag">{MESSAGES[TOOLS[0].label]}</span></div>
    <p>{MESSAGES.toolboxHint}</p>
    <label htmlFor={`${id}-text`}>{MESSAGES.toolboxText}</label>
    <textarea id={`${id}-text`} value={text} rows={3} maxLength={4096} aria-describedby={`${id}-limit`} onChange={event => { setText(event.target.value); }} />
    <p id={`${id}-limit`} className="muted small">{MESSAGES.toolboxLimit}</p>
    <div className="toolbox-colors"><label htmlFor={`${id}-start`}>{MESSAGES.toolboxStart}<input id={`${id}-start`} type="color" value={start} onChange={event => { setStart(event.target.value); }} /></label>
      <label htmlFor={`${id}-end`}>{MESSAGES.toolboxEnd}<input id={`${id}-end`} type="color" value={end} onChange={event => { setEnd(event.target.value); }} /></label></div>
    {!result.ok ? <p className="form-error" role="status">{MESSAGES[errors[result.error]]}</p> : <>
      <h3>{MESSAGES.toolboxPreview}</h3><div className="toolbox-preview" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} aria-label={MESSAGES.toolboxPreview}>
        {result.characters.map((character, index) => <span key={index} style={{ color: character.color }}>{character.text}</span>)}
      </div>
    </>}
    <label htmlFor={`${id}-output`}>{MESSAGES.toolboxOutput}</label>
    <textarea ref={output} id={`${id}-output`} className="toolbox-output" readOnly value={result.ok ? result.json : ''} rows={5} aria-describedby={`${id}-format`} />
    <button className="secondary" disabled={!result.ok} onClick={() => { output.current?.focus(); output.current?.select(); }}>{MESSAGES.toolboxSelect}</button>
    <p id={`${id}-format`} className="muted small">{MESSAGES.toolboxFormatHint}</p>
  </section>;
}
