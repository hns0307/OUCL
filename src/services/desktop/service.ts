import type { StorageClient } from '../workers/storage-client.js';
import { defaultDesktop } from '../storage/desktop.js';
import type { Appearance, DesktopSnapshot, DesktopState, ForumDraft } from '../../shared/contracts/desktop.js';
import { WorkerError } from '../workers/protocol.js';

/** Owns fixed desktop state; appearance and local drafts are CAS updated without touching launch settings. */
export class DesktopService {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly storage: Pick<StorageClient, 'readDesktop' | 'writeDesktop'>) {}
  /** Returns defaults without creating a record on first read. */
  async get(): Promise<DesktopSnapshot> { const current = await this.storage.readDesktop(); return { revision: current?.revision ?? 0, ...(current?.data ?? defaultDesktop()) }; }
  private update(expected: number, change: (state: DesktopState) => DesktopState): Promise<DesktopSnapshot> {
    const pending = this.tail.then(async () => { const current = await this.get(); if (current.revision !== expected) throw new WorkerError('REVISION_CONFLICT');
      const saved = await this.storage.writeDesktop(expected, change({ appearance: current.appearance, drafts: current.drafts })); return { revision: saved.revision, ...saved.data }; });
    this.tail = pending.then(() => {}, () => {}); return pending;
  }
  /** Replaces validated appearance values, preserving all drafts. */
  appearance(expected: number, appearance: Appearance): Promise<DesktopSnapshot> { return this.update(expected, state => ({ ...state, appearance })); }
  /** Saves a local draft; it never publishes, authenticates, or claims a remote post. */
  saveDraft(expected: number, draft: ForumDraft): Promise<DesktopSnapshot> { return this.update(expected, state => ({ ...state, drafts: [...state.drafts.filter(item => item.id !== draft.id), { ...draft, updatedAt: new Date().toISOString() }] })); }
  /** Deletes only the selected local draft within the known fixed record. */
  deleteDraft(expected: number, id: string): Promise<DesktopSnapshot> { return this.update(expected, state => ({ ...state, drafts: state.drafts.filter(item => item.id !== id) })); }
}
