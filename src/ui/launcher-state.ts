import { create } from 'zustand';
import type { AccountSummary, SettingsSummary } from '../shared/contracts/profiles.js';
import type { InstanceSummary, TaskSnapshot } from '../shared/contracts/instances.js';
import type { InstanceLoaderIdentity } from '../shared/contracts/instances-v2.js';
import type { MessageKey } from '../shared/locales/messages.js';

export type Page = 'home' | 'downloads' | 'announcements' | 'settings';
interface LauncherState {
  page: Page; setPage(page: Page): void; rootId: string | undefined; setRoot(rootId: string | undefined): void;
  accounts: AccountSummary[]; accountId: string | undefined; selectAccount(id: string | undefined): void;
  instances: InstanceSummary[]; instanceId: string | undefined; selectInstance(id: string): void;
  instanceLoaders: Record<string, InstanceLoaderIdentity>;
  tasks: TaskSnapshot[]; settings: SettingsSummary | undefined; error: MessageKey | undefined;
  refreshProfiles(): Promise<void>; refreshGame(): Promise<void>; refreshSettings(): Promise<void>;
}
let refreshing = false;
/** Shared renderer projections survive navigation. IO remains behind the narrow preload bridge. */
export const useLauncher = create<LauncherState>((set, get) => ({
  page: 'home', setPage: page => { set({ page }); }, rootId: undefined,
  setRoot: rootId => { if (rootId !== get().rootId) set({ rootId, instances: [], instanceLoaders: {}, instanceId: undefined, tasks: [] }); },
  accounts: [], accountId: undefined, selectAccount: accountId => { set({ accountId }); },
  instances: [], instanceLoaders: {}, instanceId: undefined, selectInstance: instanceId => { set({ instanceId }); }, tasks: [], settings: undefined, error: undefined,
  refreshProfiles: async () => {
    if (!window.oucl) return; const result = await window.oucl.listAccounts();
    if (result.ok) set({ accounts: result.data.items, accountId: result.data.items.some(a => a.accountId === get().accountId) ? get().accountId : result.data.items[0]?.accountId }); else set({ error: result.error.messageKey });
  },
  refreshSettings: async () => { if (!window.oucl) return; const result = await window.oucl.getSettings(); if (result.ok) set({ settings: result.data }); else set({ error: result.error.messageKey }); },
  refreshGame: async () => {
    const rootId = get().rootId; if (!window.oucl || !rootId || refreshing) return; refreshing = true;
    try {
      const [listed, enhanced, tasks] = await Promise.all([window.oucl.listInstances({ rootId, limit: 100 }), window.oucl.listInstancesV2(rootId), window.oucl.listTasks({ limit: 100 })]);
      if (get().rootId !== rootId) return;
      if (listed.ok) set({ instances: listed.data.items, instanceId: listed.data.items.some(i => i.instanceId === get().instanceId) ? get().instanceId : listed.data.items.find(i => i.state === 'ready')?.instanceId ?? listed.data.items[0]?.instanceId });
      if (enhanced.ok) set({ instanceLoaders: Object.fromEntries(enhanced.data.items.map(item => [item.instanceId, item.loader])) });
      if (tasks.ok) set({ tasks: tasks.data.items });
    } catch { set({ error: 'unavailable' }); } finally { refreshing = false; }
  },
}));
