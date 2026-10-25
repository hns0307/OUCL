import { useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';

export interface Announcement { id: string; title: string; category: 'club' | 'update'; publishedAt: string; paragraphs: string[] }
/** UI-only announcement surface. Production has no fabricated messages or backend calls. */
export function AnnouncementsPage({ items = [], preview = false }: { items?: Announcement[]; preview?: boolean }) {
  const [category, setCategory] = useState('all'); const [selectedId, setSelectedId] = useState<string>();
  const visible = items.filter(item => category === 'all' || item.category === category);
  const selected = visible.find(item => item.id === selectedId);
  return <div className="announcements-layout"><section className="panel"><div className="tabs compact-tabs" aria-label={MESSAGES.uiAnnouncementCategory}>
    {(['all', 'club', 'update'] as const).map(id => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id); }}>{id === 'all' ? MESSAGES.uiAllAnnouncements : id === 'club' ? MESSAGES.uiClubAnnouncements : MESSAGES.uiUpdateAnnouncements}</button>)}
    </div>{preview && <p className="tag">{MESSAGES.uiPreviewOnly}</p>}
    {visible.length ? visible.map(item => <button className="resource-row" key={item.id} aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); }}><span className="resource-info"><strong>{item.title}</strong><small>{item.publishedAt}</small></span><span>›</span></button>) : <div className="announcement-empty"><span className="empty-glyph">◇</span><h2>{MESSAGES.uiNoAnnouncements}</h2><p>{MESSAGES.uiAnnouncementHint}</p></div>}
    </section><aside className="panel announcement-detail"><span className="eyebrow">OUCL COMMUNITY</span><h2>{selected?.title ?? MESSAGES.uiAnnouncementDetail}</h2>
      {selected ? <><p className="muted small">{selected.publishedAt}</p>{selected.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}</> : <><p className="muted">{MESSAGES.uiChooseAnnouncement}</p><div className="announcement-lines"><i /><i /><i /></div></>}
    </aside></div>;
}
