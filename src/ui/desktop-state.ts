import { create } from 'zustand';
import { DEFAULT_APPEARANCE } from '../shared/contracts/desktop.js';
import type { Appearance, DesktopSnapshot } from '../shared/contracts/desktop.js';
import type { MessageKey } from '../shared/locales/messages.js';

interface DesktopUiState {
  snapshot: DesktopSnapshot; preview: Appearance | undefined; loaded: boolean; busy: boolean; error: MessageKey | undefined;
  load(): Promise<void>; saveAppearance(appearance: Appearance, preservePreview?: boolean): Promise<boolean>; setPreview(value: Appearance | undefined): void;
}
/** One real desktop projection survives navigation and communicates only through validated preload methods. */
export const useDesktop = create<DesktopUiState>((set, get) => ({
  snapshot: { revision: 0, appearance: structuredClone(DEFAULT_APPEARANCE), drafts: [] }, preview: undefined, loaded: false, busy: false, error: undefined,
  setPreview: preview => { set({ preview }); },
  load: async () => {
    if (!window.oucl?.getDesktop) return;
    try { const result = await window.oucl.getDesktop(); if (result.ok) set({ snapshot: result.data, loaded: true, error: undefined }); else set({ error: result.error.messageKey }); }
    catch { set({ error: 'unavailable' }); }
  },
  saveAppearance: async (appearance, preservePreview = false) => {
    if (!window.oucl?.updateAppearance || get().busy || !get().loaded) return false;
    set({ busy: true, error: undefined });
    try { const result = await window.oucl.updateAppearance(crypto.randomUUID(), { expectedRevision: get().snapshot.revision, appearance });
      if (result.ok) { const preview = get().preview; set({ snapshot: result.data, preview: preservePreview && preview ? { ...preview, sidebarCollapsed: appearance.sidebarCollapsed } : undefined }); return true; }
      set({ error: result.error.messageKey }); await get().load(); set({ error: result.error.messageKey }); return false;
    } catch { set({ error: 'unavailable' }); return false; } finally { set({ busy: false }); }
  },
}));
