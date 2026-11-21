import type { ForumDraft } from '../shared/contracts/desktop.js';

export type ForumCategory = ForumDraft['category'];
export interface ForumTopic { id: string; title: string; category: ForumCategory; body: string; updatedAt: string; state: 'draft' | 'published'; author: string }
export interface ForumQuery { category?: ForumCategory; search: string }
/** Backend integration boundary: remote adapters implement list/read without changing the forum UI. No wire protocol or server URL is assumed. */
export interface ForumDataSource {
  readonly mode: 'local' | 'remote';
  list(query: ForumQuery, signal: AbortSignal): Promise<ForumTopic[]>;
  read(id: string, signal: AbortSignal): Promise<ForumTopic | undefined>;
  publish?(input: Pick<ForumDraft, 'title' | 'category' | 'body'>, signal: AbortSignal): Promise<ForumTopic>;
}
/** Default adapter projects only real persisted drafts; remote publishing is deliberately absent. */
export const localForumSource: ForumDataSource = {
  mode: 'local',
  async list(query, signal) {
    if (!window.oucl) throw new Error('UNAVAILABLE');
    const result = await window.oucl.getDesktop(); if (signal.aborted) return []; if (!result.ok) throw new Error(result.error.code);
    const needle = query.search.trim().toLocaleLowerCase(); return result.data.drafts.filter(item => (!query.category || item.category === query.category) && `${item.title}\n${item.body}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => ({ ...item, state: 'draft', author: '' }));
  },
  async read(id, signal) { const items = await this.list({ search: '' }, signal); return items.find(item => item.id === id); },
};
