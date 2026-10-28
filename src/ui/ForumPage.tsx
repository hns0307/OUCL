import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import type { ForumDraft } from '../shared/contracts/desktop.js';
import { useDesktop } from './desktop-state.js';
import { localForumSource } from './forum-source.js';
import type { ForumCategory, ForumDataSource, ForumTopic } from './forum-source.js';

const LABELS = { general: 'uiForumGeneral', game: 'uiForumGame', mods: 'uiForumMods', builds: 'uiForumBuilds' } as const;
/** Simple accessible forum with injectable data source, real local drafts and no pretend publishing. */
export function ForumPage({ source = localForumSource }: { source?: ForumDataSource }) {
  const desktop = useDesktop(); const [category, setCategory] = useState<ForumCategory>(); const [query, setQuery] = useState(''); const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [selected, setSelected] = useState<ForumTopic>(); const [editing, setEditing] = useState<ForumDraft>(); const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<MessageKey>(); const [refresh, setRefresh] = useState(0);
  const reading = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { reading.current?.abort(); }, [source]);
  useEffect(() => {
    if (!desktop.loaded) return; const controller = new AbortController(); setBusy(true);
    void source.list({ ...(category ? { category } : {}), search: query }, controller.signal).then(items => { if (!controller.signal.aborted) { setTopics(items); setError(undefined); } }).catch(() => { if (!controller.signal.aborted) setError('unavailable'); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); };
  }, [source, desktop.loaded, desktop.snapshot.revision, category, query, refresh]);
  function leaveEdit(): boolean { if (dirty && !window.confirm(MESSAGES.uiConfirmDiscard)) return false; reading.current?.abort(); setEditing(undefined); setDirty(false); return true; }
  async function select(topic: ForumTopic): Promise<void> { if (!leaveEdit()) return; const controller = new AbortController(); reading.current = controller; setSelected(undefined);
    try { const result = await source.read(topic.id, controller.signal); if (!controller.signal.aborted) setSelected(result); } catch { if (!controller.signal.aborted) setError('unavailable'); } }
  async function save(): Promise<void> {
    if (!window.oucl || !editing || busy || !editing.title.trim() || !editing.body.trim()) return; setBusy(true); setError(undefined);
    try {
      if (source.mode === 'remote' && source.publish) { const published = await source.publish({ title: editing.title, category: editing.category, body: editing.body }, new AbortController().signal); setSelected(published); setEditing(undefined); setDirty(false); setRefresh(value => value + 1); return; }
      const result = await window.oucl.saveForumDraft(crypto.randomUUID(), { expectedRevision: desktop.snapshot.revision, draft: editing });
      if (result.ok) { setDirty(false); setEditing(undefined); await desktop.load(); setSelected({ ...editing, state: 'draft', author: '' }); } else { setError(result.error.messageKey); await desktop.load(); }
    } catch { setError('unavailable'); } finally { setBusy(false); }
  }
  async function remove(): Promise<void> {
    if (!window.oucl || !selected || !window.confirm(MESSAGES.uiConfirmDeleteDraft)) return; setBusy(true);
    try { const result = await window.oucl.deleteForumDraft(crypto.randomUUID(), { expectedRevision: desktop.snapshot.revision, id: selected.id }); if (result.ok) { setSelected(undefined); await desktop.load(); } else setError(result.error.messageKey); }
    catch { setError('unavailable'); } finally { setBusy(false); }
  }
  return <section className="forum-view"><div className="forum-toolbar"><label><input type="search" aria-label={MESSAGES.uiForumSearch} placeholder={MESSAGES.uiForumSearch} maxLength={120} value={query} onChange={event => { setQuery(event.target.value); }} /></label>
    <button disabled={!desktop.loaded || source.mode !== 'local' && !source.publish} onClick={() => { if (!leaveEdit()) return; setSelected(undefined); setEditing({ id: crypto.randomUUID(), title: '', category: category ?? 'general', body: '', updatedAt: new Date().toISOString() }); }}>{MESSAGES.uiForumNew}</button></div>
    <p className="muted small">{source.mode === 'local' ? MESSAGES.uiForumLocal : ''}</p><div className="forum-layout"><aside className="panel forum-categories"><button className="forum-category" aria-pressed={!category} onClick={() => { setCategory(undefined); }}>{MESSAGES.uiForumAll}</button>
      {(Object.keys(LABELS) as ForumCategory[]).map(id => <button key={id} className="forum-category" aria-pressed={category === id} onClick={() => { setCategory(id); }}>{MESSAGES[LABELS[id]]}</button>)}</aside>
    <section className="panel forum-topics" aria-busy={busy}><h2>{source.mode === 'local' ? MESSAGES.uiForumDrafts : MESSAGES.uiForumAll}</h2>
      {topics.length ? topics.map(topic => <button className="resource-row" key={topic.id} aria-pressed={selected?.id === topic.id} onClick={() => { void select(topic); }}><span className="forum-topic-symbol">◇</span><span className="resource-info"><strong>{topic.title}</strong><small>{MESSAGES[LABELS[topic.category]]} · {topic.state === 'draft' ? MESSAGES.uiForumDraft : topic.author}</small><small>{new Date(topic.updatedAt).toLocaleDateString()}</small></span></button>) : <div className="empty-state"><span className="empty-glyph">◇</span><h3>{MESSAGES.uiForumEmpty}</h3><p>{MESSAGES.uiForumChoose}</p></div>}
    </section><article className="panel forum-reader">{editing ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>{MESSAGES.uiForumTitle}<input value={editing.title} maxLength={120} required onChange={event => { setEditing({ ...editing, title: event.target.value }); setDirty(true); }} /></label>
      <label>{MESSAGES.uiForumCategory}<select value={editing.category} onChange={event => { setEditing({ ...editing, category: event.target.value as ForumCategory }); setDirty(true); }}>{(Object.keys(LABELS) as ForumCategory[]).map(id => <option key={id} value={id}>{MESSAGES[LABELS[id]]}</option>)}</select></label>
      <label>{MESSAGES.uiForumBody}<textarea value={editing.body} maxLength={20000} required rows={10} onChange={event => { setEditing({ ...editing, body: event.target.value }); setDirty(true); }} /></label>
      <p className="muted small">{dirty ? MESSAGES.uiUnsavedChanges : MESSAGES.uiForumDraft}</p><div className="save-row"><button disabled={busy || !editing.title.trim() || !editing.body.trim()} type="submit">{source.mode === 'remote' ? MESSAGES.uiForumPublish : MESSAGES.uiForumSave}</button><button type="button" className="secondary" onClick={leaveEdit}>{MESSAGES.uiCancelEdit}</button></div>
    </form> : selected ? <><span className="tag">{selected.state === 'draft' ? MESSAGES.uiForumDraft : MESSAGES[LABELS[selected.category]]}</span><h2>{selected.title}</h2><div className="forum-body">{selected.body}</div>{source.mode === 'local' && selected.state === 'draft' && <div className="save-row"><button onClick={() => { setEditing({ id: selected.id, title: selected.title, category: selected.category, body: selected.body, updatedAt: selected.updatedAt }); }}>{MESSAGES.uiForumEdit}</button><button className="secondary" onClick={() => { void remove(); }}>{MESSAGES.uiForumDelete}</button></div>}</> : <div className="empty-state">{MESSAGES.uiForumChoose}</div>}</article></div>
    {error && <p className="form-error" role="alert">{MESSAGES[error]} <button className="text-button" onClick={() => { setRefresh(value => value + 1); }}>{MESSAGES.uiRetry}</button></p>}
  </section>;
}
