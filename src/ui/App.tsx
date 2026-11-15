import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import { useConnection } from './state.js';
import { useLauncher } from './launcher-state.js';
import type { Page } from './launcher-state.js';
import { AccountsPanel } from './AccountsPanel.js';
import { SettingsPage } from './SettingsPage.js';
import { VersionCatalog } from './VersionCatalog.js';
import { InstallPanel } from './InstallPanel.js';
import { TaskCenter } from './TaskCenter.js';
import { activeTask } from './task-query.js';
import { LaunchControls, useGameSessions } from './LaunchControls.js';
import { ResourceBrowser } from './ResourceBrowser.js';
import { FixedPackPreview } from './FixedPackPreview.js';
import { ForumPage } from './ForumPage.js';
import { useDesktop } from './desktop-state.js';
import { Avatar } from './Avatar.js';
import { ModPanel } from './ModPanel.js';
import type { Capability } from '../shared/contracts/handshake.js';
import { InstanceOverview } from './InstanceOverview.js';
import { InstanceFolders } from './InstanceFolders.js';
import { FirstRunGuide } from './FirstRunGuide.js';
import { ToolsWorkspace } from './ToolsWorkspace.js';
import { overviewSession } from './instance-overview.js';

const NAV: { id: Page; label: keyof typeof MESSAGES }[] = [{ id: 'home', label: 'uiHome' }, { id: 'downloads', label: 'uiDownloads' }, { id: 'announcements', label: 'uiForum' }, { id: 'tools', label: 'uiToolbox' }, { id: 'settings', label: 'uiSettings' }];
type DownloadTab = 'minecraft' | 'mod' | 'resourcepack' | 'shader' | 'library';
/** Desktop shell, sharing real profiles, instances and task state across persistent pages. */
export function App() {
  const { status, setStatus } = useConnection(); const state = useLauncher(); const desktop = useDesktop();
  const appearance = desktop.preview ?? desktop.snapshot.appearance;
  useEffect(() => { void desktop.load(); }, [desktop.load]);
  useEffect(() => {
    const root = document.documentElement; for (const [key, value] of Object.entries({ green: appearance.accent, page: appearance.background, surface: appearance.surface, ink: appearance.ink })) root.style.setProperty(`--${key}`, value);
  }, [appearance]);
  const [capabilities, setCapabilities] = useState<string[]>([]); const [downloadTab, setDownloadTab] = useState<DownloadTab>('minecraft'); const [versionId, setVersionId] = useState<string>();
  const has = (name: Capability): boolean => capabilities.includes(name);
  useEffect(() => {
    let active = true;
    if (!window.oucl) { setStatus('disconnected'); return; }
    void window.oucl.handshake().then(async result => {
      if (!active) return; setStatus(result.ok && result.data.capabilities.includes('instances.v1') ? 'connected' : 'disconnected');
      if (result.ok) { setCapabilities(result.data.capabilities); await Promise.all([state.refreshProfiles(), state.refreshSettings()]); }
    }).catch(() => { if (active) setStatus('disconnected'); });
    return () => { active = false; };
  }, [setStatus, state.refreshProfiles, state.refreshSettings]);
  useEffect(() => {
    // Do not replace an explicit history cursor every 15 seconds while the player browses its pages.
    const refresh = (): void => { if (!document.hidden && !useLauncher.getState().historyBrowsing) void state.refreshGame(); };
    refresh(); const timer = setInterval(refresh, 15000); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [state.rootId, state.refreshGame]);
  const accountsFocus = useRef<HTMLDivElement>(null);
  const sessions = useGameSessions(has('game.v1'), state.rootId);
  const account = state.accounts.find(a => a.accountId === state.accountId); const instance = state.instances.find(i => i.instanceId === state.instanceId);
  const loaderName = (id: string): string => { const value = state.instanceLoaders[id]; return !value || value.kind === 'vanilla' ? MESSAGES.uiVanilla : `${value.kind === 'fabric' ? 'Fabric' : value.kind === 'quilt' ? 'Quilt' : value.kind === 'forge' ? 'Forge' : 'NeoForge'} ${value.version}`; };
  const activeTasks = state.tasks.filter(activeTask).length;
  const recoveryTasks = state.tasks.filter(task => task.state === 'needsRecovery').length;
  return <div className={`app-shell ${appearance.sidebarCollapsed ? 'sidebar-collapsed' : ''} density-${appearance.density}`}>
    <header className="topbar"><div className="brand-lockup"><button className="sidebar-toggle secondary" aria-expanded={!appearance.sidebarCollapsed} aria-label={appearance.sidebarCollapsed ? MESSAGES.uiExpandSidebar : MESSAGES.uiCollapseSidebar} disabled={!desktop.loaded || desktop.busy} onClick={() => { void desktop.saveAppearance({ ...desktop.snapshot.appearance, sidebarCollapsed: !appearance.sidebarCollapsed }, true); }}>☰</button>{appearance.icon ? <img className="brand-custom-icon" src={appearance.icon} alt="" /> : <span className="brand-symbol">O<span /></span>}<strong>OUCL</strong><span className="brand-caption">{MESSAGES.uiBrandCaption}</span></div>
      <nav className="top-nav" aria-label={MESSAGES.uiNavigation}>{NAV.map(n => <button key={n.id} aria-current={state.page === n.id ? 'page' : undefined} onClick={() => { state.setPage(n.id); }}>{MESSAGES[n.label]}</button>)}</nav>
      <span className="status" role="status" data-status={status}><i />{MESSAGES[status]}</span></header>
    <div className="workspace"><aside className="sidebar"><div className="sidebar-heading"><span>{MESSAGES.uiGames}</span><span className="count">{has('instances.v1') ? state.instances.length : '—'}</span></div>
      <div className="sidebar-list">{!has('instances.v1') ? <p className="sidebar-empty">{status === 'connecting' ? MESSAGES.connecting : MESSAGES.rootsUnavailable}</p> : state.instances.length === 0 ? <p className="sidebar-empty">{MESSAGES.uiNoGames}</p> : state.instances.map((item, index) => <button className="instance-item" aria-pressed={state.instanceId === item.instanceId} title={item.displayName} key={item.instanceId} data-instance-id={item.instanceId} onClick={() => { state.selectInstance(item.instanceId); state.setPage('home'); }}>
        <span className={`instance-icon icon-${index % 3}`}>◈</span><span><strong>{item.displayName}</strong><small>{item.mcVersionId} · {loaderName(item.instanceId)} · {item.state === 'ready' ? MESSAGES.stateReady : item.state === 'installing' ? MESSAGES.stateInstalling : item.state === 'needsRecovery' ? MESSAGES.stageRecovery : item.state === 'cancelled' ? MESSAGES.stageCancelled : MESSAGES.stageFailed}</small></span><span className="selected-dot" />
      </button>)}</div>
      {state.rootId && !state.instancesComplete && <p className="sidebar-empty">{MESSAGES.instancesPartial} <button disabled={state.gameListBusy} onClick={() => { void state.loadMoreGame(); }}>{MESSAGES.instancesLoadMore}</button></p>}
      <button className="add-game secondary" onClick={() => { setDownloadTab('minecraft'); state.setPage('downloads'); }}>＋ {MESSAGES.uiInstallGame}</button>
      <div className="sidebar-bottom"><span className="tiny-square" /><span>OUCL <strong>0.3.0</strong></span><small>{MESSAGES.uiLocalLibrary}</small></div>
    </aside>
    <main className="main-content"><div className="page-heading"><div><span className="eyebrow">{state.page === 'home' ? 'YOUR NEXT ADVENTURE' : state.page === 'downloads' ? 'EXPLORE & DOWNLOAD' : state.page === 'announcements' ? 'STAY CONNECTED' : state.page === 'tools' ? 'CREATE & EXPERIMENT' : 'MAKE IT YOURS'}</span><h1>{MESSAGES[NAV.find(n => n.id === state.page)!.label]}</h1><p>{state.page === 'home' ? MESSAGES.uiHomeSubtitle : state.page === 'downloads' ? MESSAGES.uiDownloadsSubtitle : state.page === 'announcements' ? MESSAGES.uiForumSubtitle : state.page === 'tools' ? MESSAGES.toolboxHint : MESSAGES.uiSettingsSubtitle}</p></div>
      {state.rootId && (activeTasks > 0 || recoveryTasks > 0 || !state.tasksComplete) && <button className="task-pill" onClick={() => { state.setPage('downloads'); }}>{MESSAGES.taskLoadedActive} {activeTasks} · {MESSAGES.taskRecoveryCount} {recoveryTasks}{!state.tasksComplete && <> · {MESSAGES.taskListPartial}</>}</button>}</div>
      {status === 'disconnected' && <p className="error-banner" role="alert">{MESSAGES.unavailable}</p>}
      <div hidden={state.page !== 'home'}><FirstRunGuide settings={state.settings} rootId={state.rootId} accounts={state.accounts} accountId={state.accountId}
        enabled={has('settings.v1') && has('accounts.v1')} error={state.error} onOpenSettings={() => { state.setPage('settings'); }} onOpenAccounts={() => { accountsFocus.current?.focus(); }}
        onRetry={async () => { useLauncher.setState({ error: undefined }); await Promise.all([state.refreshProfiles(), state.refreshSettings()]); await state.refreshGame(); }} />
        <div className={`home-layout layout-${appearance.layout}`}><section className="home-main"><div className="adventure-card" style={{ order: appearance.homeOrder.indexOf('banner') }} hidden={appearance.homeHidden.includes('banner')}><div className="adventure-content"><span className="tag light">MINECRAFT JAVA EDITION</span><h2>{MESSAGES.uiAdventureTitle}</h2><p>{MESSAGES.uiAdventureSubtitle}</p></div><div className="landscape" aria-hidden="true"><i /><i /><i /><i /><span /></div></div>
        <section className="panel selected-instance" style={{ order: appearance.homeOrder.indexOf('game') }}><div className="section-heading"><h2>{MESSAGES.uiSelectedGame}</h2><span className="tag">{instance ? loaderName(instance.instanceId) : MESSAGES.uiVanilla}</span></div>
          {instance ? <><h3>{instance.displayName}</h3><div className="instance-facts"><span><small>{MESSAGES.uiGameVersion}</small><strong>{instance.mcVersionId}</strong></span></div>
            <InstanceOverview key={`${state.rootId}:${instance.instanceId}`} instance={instance} rootId={state.rootId} targetsEnabled={has('task-targets.v1')} sessions={sessions} tasks={state.tasks} onOpenTasks={() => { state.setPage('downloads'); }} />
            {instance.state === 'ready' && has('instance-folders.v1') && <InstanceFolders key={`${state.rootId}:${instance.instanceId}`} instanceId={instance.instanceId} />}
          </> : !has('instances.v1') ? <p role="status">{status === 'connecting' ? MESSAGES.connecting : MESSAGES.rootsUnavailable}</p> : <div className="empty-state"><h3>{MESSAGES.uiStartHere}</h3><p>{MESSAGES.uiFirstInstall}</p><button onClick={() => { state.setPage(state.rootId ? 'downloads' : 'settings'); }}>{state.rootId ? MESSAGES.uiInstallGame : MESSAGES.chooseStorage}</button></div>}
        </section><button className="announcement-shortcut panel" style={{ order: appearance.homeOrder.indexOf('community') }} hidden={appearance.homeHidden.includes('community')} onClick={() => { state.setPage('announcements'); }}><span className="notice-icon">◇</span><span><strong>{MESSAGES.uiForum}</strong><small>{MESSAGES.uiForumLocal}</small></span><span>↗</span></button>
      </section><aside className="panel character-card"><div className="character-top"><span className="eyebrow">PLAYER PROFILE</span><span className="tag">{MESSAGES.uiOffline}</span></div><div className="avatar-stage"><Avatar /><div className="avatar-grid" /></div>
        <div className="player-name"><h2>{account?.displayName ?? MESSAGES.uiGuest}</h2><span>{account?.gameName ?? MESSAGES.uiChooseProfile}</span></div><div ref={accountsFocus} tabIndex={-1} className="accounts-focus"><AccountsPanel enabled={has('accounts.v1')} /></div>
        {instance?.state === 'ready' ? <LaunchControls key={`${state.rootId}:${instance.instanceId}`} instance={instance} accountId={state.accountId} current={overviewSession(instance.instanceId, sessions)} /> : <button className="primary" disabled>{MESSAGES.launchGame}</button>}
      </aside></div>{instance && <ModPanel key={`${state.rootId}:${instance.instanceId}`} instance={instance} enabled={has('mods.v1')} targetsEnabled={has('task-targets.v1')}
        rootId={state.rootId} maintenanceEnabled={has('mods-maintenance-preview.v1')} />}</div>
      <div hidden={state.page !== 'downloads'}><div className="tabs download-tabs">{(['minecraft', 'mod', 'resourcepack', 'shader', 'library'] as const).map(id => <button key={id} aria-pressed={downloadTab === id} onClick={() => { setDownloadTab(id); }}>{id === 'minecraft' ? 'Minecraft' : id === 'mod' ? MESSAGES.uiMods : id === 'resourcepack' ? MESSAGES.uiResourcepacks : id === 'shader' ? MESSAGES.uiShaders : MESSAGES.uiLibrary}</button>)}</div>
        <div hidden={downloadTab !== 'minecraft'}><div className="download-note"><span className="source-badge">Mojang</span><p>{MESSAGES.uiVanillaDownloadHint}</p></div><div className="install-layout"><VersionCatalog enabled={has('catalog.v1')} selected={versionId} onSelect={setVersionId} /><InstallPanel enabled={has('instances.v1')} loadersEnabled={has('loaders.v1')} rootId={state.rootId} versionId={versionId} /></div><FixedPackPreview enabled={has('packs.fixed-preview.v1')} /></div>
        <div hidden={downloadTab === 'minecraft'}><ResourceBrowser enabled={has('resources.v1') && state.page === 'downloads' && downloadTab !== 'minecraft'}
          modPlansEnabled={has('mods.v1')} {...(instance && state.instanceLoaders[instance.instanceId]?.kind !== 'vanilla' ? { instance } : {})}
          kind={downloadTab === 'resourcepack' ? 'resourcepack' : downloadTab === 'shader' ? 'shader' : 'mod'} libraryOnly={downloadTab === 'library'} /></div>
        {state.page === 'downloads' && <TaskCenter key={state.rootId ?? 'no-root'} />}
      </div>
      {state.page === 'tools' && <ToolsWorkspace onlineEnabled={has('tools.isolated.v1')} distributionEnabled={has('distribution.preview.v1')} rootId={state.rootId} instanceId={instance?.state === 'ready' ? instance.instanceId : undefined} />}
      <div hidden={state.page !== 'announcements'}><ForumPage /></div><div hidden={state.page !== 'settings'}><SettingsPage enabled={has('settings.v1')} rootsEnabled={has('roots.v1')} downloadsEnabled={has('downloads.v1')} /></div>
      <footer className="page-footer"><span>OUCL</span><span>{MESSAGES.uiFooter}</span><span>0.3.0</span></footer>
    </main></div>
  </div>;
}

