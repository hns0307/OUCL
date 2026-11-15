import { create } from 'zustand';
import type { AccountSummary, SettingsSummary } from '../shared/contracts/profiles.js';
import type { InstanceSummary, TaskSnapshot } from '../shared/contracts/instances.js';
import type { InstanceLoaderIdentity } from '../shared/contracts/instances-v2.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { rendererTaskReads, TaskQuerySession } from './task-query.js';

export type Page = 'home' | 'downloads' | 'announcements' | 'settings' | 'tools';
interface LauncherState {
  page: Page; setPage(page: Page): void; rootId: string | undefined; setRoot(rootId: string | undefined): void;
  accounts: AccountSummary[]; accountId: string | undefined; selectAccount(id: string | undefined): void;
  instances: InstanceSummary[]; instanceId: string | undefined; selectInstance(id: string): void;
  instanceLoaders: Record<string, InstanceLoaderIdentity>;
  tasks: TaskSnapshot[]; settings: SettingsSummary | undefined; error: MessageKey | undefined;
  tasksComplete: boolean; instancesComplete: boolean; historyComplete: boolean; historyRestarted: boolean; historyBrowsing: boolean; gameListBusy: boolean;
  gameListError: MessageKey | undefined; taskQueryErrors: Record<string, MessageKey>;
  loadMoreGame(history?: boolean): Promise<void>; queryTask(taskId: string): Promise<void>;
  refreshProfiles(): Promise<void>; refreshGame(): Promise<void>; refreshSettings(): Promise<void>;
}
let generation = 0;
const pendingTaskReads = new Set<string>();
let current: { rootId: string; session: TaskQuerySession; busy: boolean; generation: number } | undefined;
/** Shared renderer projections survive navigation. IO remains behind the narrow preload bridge. */
export const useLauncher = create<LauncherState>((set, get) => ({
  page: 'home', setPage: page => { set({ page }); }, rootId: undefined,
  setRoot: rootId => { if (rootId !== get().rootId) {
    generation++; current = undefined;
    set({ rootId, instances: [], instanceLoaders: {}, instanceId: undefined, tasks: [], tasksComplete: false, instancesComplete: false,
      historyComplete: false, historyRestarted: false, historyBrowsing: false, gameListBusy: false, gameListError: undefined, taskQueryErrors: {} });
  } },
  accounts: [], accountId: undefined, selectAccount: accountId => { set({ accountId }); },
  instances: [], instanceLoaders: {}, instanceId: undefined, selectInstance: instanceId => { set({ instanceId }); }, tasks: [], settings: undefined, error: undefined,
  tasksComplete: false, instancesComplete: false, historyComplete: false, historyRestarted: false, historyBrowsing: false, gameListBusy: false, gameListError: undefined, taskQueryErrors: {},
  refreshProfiles: async () => {
    if (!window.oucl) return; const result = await window.oucl.listAccounts();
    if (result.ok) set({ accounts: result.data.items, accountId: result.data.items.some(a => a.accountId === get().accountId) ? get().accountId : result.data.items[0]?.accountId }); else set({ error: result.error.messageKey });
  },
  refreshSettings: async () => { if (!window.oucl) return; const result = await window.oucl.getSettings(); if (result.ok) set({ settings: result.data }); else set({ error: result.error.messageKey }); },
  refreshGame: async () => {
    const rootId = get().rootId, bridge = window.oucl; if (!bridge || !rootId || current?.busy) return;
    set({ historyBrowsing: false });
    const ticket = ++generation; const valid = (): boolean => generation === ticket && get().rootId === rootId;
    async function read<T>(operation: () => Promise<T>): Promise<T> {
      const result = await rendererTaskReads.run(operation, () => valid() && !document.hidden); if (result === undefined) throw new Error('READ_ABANDONED'); return result;
    }
    current = { rootId, generation: ticket, busy: false, session: new TaskQuerySession({
      listTasks: query => read(() => bridge.listTasks(query)), listInstances: query => read(() => bridge.listInstances(query)),
      getTask: taskId => read(() => bridge.getTask(taskId)),
    }, rootId, get().tasks) };
    // Loader identity is supplementary; it does not establish instance-list completeness.
    void read(() => bridge.listInstancesV2(rootId)).then(result => {
      if (valid() && result.ok) set({ instanceLoaders: Object.fromEntries(result.data.items.map(item => [item.instanceId, item.loader])) });
    }).catch(() => {});
    await get().loadMoreGame();
  },
  loadMoreGame: async (history = false) => {
    const selected = current; if (!selected || selected.busy) return;
    const valid = (): boolean => current === selected && generation === selected.generation && get().rootId === selected.rootId;
    selected.busy = true; set({ gameListBusy: true, historyBrowsing: history || get().historyBrowsing });
    try {
      const view = await selected.session.load(() => valid() && !document.hidden, history); if (!valid()) return;
      const instanceMap = new Map((view.instancesComplete ? [] : get().instances).map(item => [item.instanceId, item]));
      for (const item of view.instances) if (item.revision >= (instanceMap.get(item.instanceId)?.revision ?? 0)) instanceMap.set(item.instanceId, item);
      const instances = [...instanceMap.values()];
      const tasks = new Map(get().tasks.map(item => [item.taskId.toLowerCase(), item]));
      for (const item of view.tasks) if (item.revision >= (tasks.get(item.taskId.toLowerCase())?.revision ?? 0)) tasks.set(item.taskId.toLowerCase(), item);
      set({ ...view, tasks: [...tasks.values()], instances, instanceId: instances.some(item => item.instanceId === get().instanceId) ? get().instanceId
        : instances.find(item => item.state === 'ready')?.instanceId ?? instances[0]?.instanceId,
      error: get().error, gameListError: view.error ? 'unavailable' : undefined });
    } catch { if (valid()) set({ gameListError: 'unavailable' }); }
    finally { selected.busy = false; if (valid()) set({ gameListBusy: false }); }
  },
  queryTask: async taskId => {
    const bridge = window.oucl, ticket = generation, rootId = get().rootId; if (!bridge || !rootId) return;
    const valid = (): boolean => generation === ticket && get().rootId === rootId;
    const pendingKey = `${ticket}:${taskId.toLowerCase()}`; if (pendingTaskReads.has(pendingKey)) return;
    pendingTaskReads.add(pendingKey);
    try {
      const result = await rendererTaskReads.run(() => bridge.getTask(taskId), valid); if (!valid() || !result) return;
      if (result.ok && result.data.snapshot.taskId.toLowerCase() === taskId.toLowerCase()) {
        const errors = { ...get().taskQueryErrors }; delete errors[taskId];
        const old = get().tasks.find(task => task.taskId.toLowerCase() === taskId.toLowerCase());
        set({ tasks: old && old.revision > result.data.snapshot.revision ? get().tasks
          : [...get().tasks.filter(task => task.taskId.toLowerCase() !== taskId.toLowerCase()), result.data.snapshot], taskQueryErrors: errors });
      } else set({ taskQueryErrors: { ...get().taskQueryErrors, [taskId]: result.ok ? 'unavailable' : result.error.messageKey } });
    } catch { if (valid()) set({ taskQueryErrors: { ...get().taskQueryErrors, [taskId]: 'unavailable' } }); }
    finally { pendingTaskReads.delete(pendingKey); }
  },
}));
