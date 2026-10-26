import { useEffect, useState } from 'react';
import { MESSAGES } from '../shared/locales/messages.js';
import { useConnection } from './state.js';
import { useLauncher } from './launcher-state.js';
import type { Page } from './launcher-state.js';
import { AccountsPanel } from './AccountsPanel.js';
import { SettingsPage } from './SettingsPage.js';
import { VersionCatalog } from './VersionCatalog.js';
import { InstallPanel } from './InstallPanel.js';
import { LaunchControls, useGameSessions } from './LaunchControls.js';
import { ResourceBrowser } from './ResourceBrowser.js';
import { AnnouncementsPage } from './AnnouncementsPage.js';
import { Avatar } from './Avatar.js';
import type { Capability } from '../shared/contracts/handshake.js';

const NAV: { id: Page; label: keyof typeof MESSAGES }[] = [{ id: 'home', label: 'uiHome' }, { id: 'downloads', label: 'uiDownloads' }, { id: 'announcements', label: 'uiAnnouncements' }, { id: 'settings', label: 'uiSettings' }];
type DownloadTab = 'minecraft' | 'mod' | 'resourcepack' | 'shader' | 'library';
/** Desktop shell, sharing real profiles, instances and task state across four persistent pages. */
export function App() {
  const { status, setStatus } = useConnection(); const state = useLauncher();
  const [capabilities, setCapabilities] = useState<string[]>([]); const [downloadTab, setDownloadTab] = useState<DownloadTab>('minecraft'); const [versionId, setVersionId] = useState<string>();
  const has = (name: Capability): boolean => capabilities.includes(name);
  useEffect(() => {
    let active = true;
    if (!window.oucl) { setStatus('disconnected'); return; }
    void window.oucl.handshake().then(async result => {
      if (!active) return; setStatus(result.ok ? 'connected' : 'disconnected');
      if (result.ok) { setCapabilities(result.data.capabilities); await Promise.all([state.refreshProfiles(), state.refreshSettings()]); }
    }).catch(() => { if (active) setStatus('disconnected'); });
    return () => { active = false; };
  }, [setStatus, state.refreshProfiles, state.refreshSettings]);
  useEffect(() => { void state.refreshGame(); const timer = setInterval(() => { void state.refreshGame(); }, 2000); return () => { clearInterval(timer); }; }, [state.rootId, state.refreshGame]);
  const sessions = useGameSessions(has('game.v1'), state.rootId);
  const account = state.accounts.find(a => a.accountId === state.accountId); const instance = state.instances.find(i => i.instanceId === state.instanceId);
  const activeTasks = state.tasks.filter(t => !['completed', 'cancelled', 'failed', 'needsRecovery'].includes(t.state)).length;
  return <div className="app-shell">
    <header className="topbar"><div className="brand-lockup"><span className="brand-symbol">O<span /></span><strong>OUCL</strong><span className="brand-caption">{MESSAGES.uiBrandCaption}</span></div>
      <nav className="top-nav" aria-label={MESSAGES.uiNavigation}>{NAV.map(n => <button key={n.id} aria-current={state.page === n.id ? 'page' : undefined} onClick={() => { state.setPage(n.id); }}>{MESSAGES[n.label]}</button>)}</nav>
      <span className="status" role="status" data-status={status}><i />{MESSAGES[status]}</span></header>
    <div className="workspace"><aside className="sidebar"><div className="sidebar-heading"><span>{MESSAGES.uiGames}</span><span className="count">{state.instances.length}</span></div>
      <div className="sidebar-list">{state.instances.length === 0 ? <p className="sidebar-empty">{MESSAGES.uiNoGames}</p> : state.instances.map((item, index) => <button className="instance-item" aria-pressed={state.instanceId === item.instanceId} key={item.instanceId} data-instance-id={item.instanceId} onClick={() => { state.selectInstance(item.instanceId); state.setPage('home'); }}>
        <span className={`instance-icon icon-${index % 3}`}>◈</span><span><strong>{item.displayName}</strong><small>{item.mcVersionId} · {item.state === 'ready' ? MESSAGES.stateReady : item.state === 'installing' ? MESSAGES.stateInstalling : item.state === 'needsRecovery' ? MESSAGES.stageRecovery : item.state === 'cancelled' ? MESSAGES.stageCancelled : MESSAGES.stageFailed}</small></span><span className="selected-dot" />
      </button>)}</div>
      <button className="add-game secondary" onClick={() => { setDownloadTab('minecraft'); state.setPage('downloads'); }}>＋ {MESSAGES.uiInstallGame}</button>
      <div className="sidebar-bottom"><span className="tiny-square" /><span>OUCL <strong>0.2.3</strong></span><small>{MESSAGES.uiLocalLibrary}</small></div>
    </aside>
    <main className="main-content"><div className="page-heading"><div><span className="eyebrow">{state.page === 'home' ? 'YOUR NEXT ADVENTURE' : state.page === 'downloads' ? 'EXPLORE & DOWNLOAD' : state.page === 'announcements' ? 'STAY CONNECTED' : 'MAKE IT YOURS'}</span><h1>{MESSAGES[NAV.find(n => n.id === state.page)!.label]}</h1><p>{state.page === 'home' ? MESSAGES.uiHomeSubtitle : state.page === 'downloads' ? MESSAGES.uiDownloadsSubtitle : state.page === 'announcements' ? MESSAGES.uiAnnouncementsSubtitle : MESSAGES.uiSettingsSubtitle}</p></div>
      {activeTasks > 0 && <button className="task-pill" onClick={() => { state.setPage('downloads'); }}>{activeTasks} {MESSAGES.uiActiveTasks}</button>}</div>
      {status === 'disconnected' && <p className="error-banner" role="alert">{MESSAGES.unavailable}</p>}
      <div hidden={state.page !== 'home'}><div className="home-layout"><section className="home-main"><div className="adventure-card"><div className="adventure-content"><span className="tag light">MINECRAFT JAVA EDITION</span><h2>{MESSAGES.uiAdventureTitle}</h2><p>{MESSAGES.uiAdventureSubtitle}</p></div><div className="landscape" aria-hidden="true"><i /><i /><i /><i /><span /></div></div>
        <section className="panel selected-instance"><div className="section-heading"><h2>{MESSAGES.uiSelectedGame}</h2><span className="tag">{MESSAGES.uiVanilla}</span></div>
          {instance ? <><h3>{instance.displayName}</h3><div className="instance-facts"><span><small>{MESSAGES.uiGameVersion}</small><strong>{instance.mcVersionId}</strong></span><span><small>{MESSAGES.uiIsolation}</small><strong>{instance.isolation === 'off' ? MESSAGES.uiShared : MESSAGES.uiIsolated}</strong></span></div><p className="muted small">{MESSAGES.uiReadyHint}</p></> : <div className="empty-state"><h3>{MESSAGES.uiStartHere}</h3><p>{MESSAGES.uiFirstInstall}</p><button onClick={() => { state.setPage(state.rootId ? 'downloads' : 'settings'); }}>{state.rootId ? MESSAGES.uiInstallGame : MESSAGES.chooseStorage}</button></div>}
        </section><button className="announcement-shortcut panel" onClick={() => { state.setPage('announcements'); }}><span className="notice-icon">◇</span><span><strong>{MESSAGES.uiAnnouncements}</strong><small>{MESSAGES.uiNoAnnouncements}</small></span><span>↗</span></button>
      </section><aside className="panel character-card"><div className="character-top"><span className="eyebrow">PLAYER PROFILE</span><span className="tag">{MESSAGES.uiOffline}</span></div><div className="avatar-stage"><Avatar /><div className="avatar-grid" /></div>
        <div className="player-name"><h2>{account?.displayName ?? MESSAGES.uiGuest}</h2><span>{account?.gameName ?? MESSAGES.uiChooseProfile}</span></div><AccountsPanel enabled={has('accounts.v1')} />
        {instance?.state === 'ready' ? <LaunchControls key={instance.instanceId} instance={instance} accountId={state.accountId} current={sessions.find(s => s.instanceId === instance.instanceId)} /> : <button className="primary" disabled>{MESSAGES.launchGame}</button>}
      </aside></div></div>
      <div hidden={state.page !== 'downloads'}><div className="tabs download-tabs">{(['minecraft', 'mod', 'resourcepack', 'shader', 'library'] as const).map(id => <button key={id} aria-pressed={downloadTab === id} onClick={() => { setDownloadTab(id); }}>{id === 'minecraft' ? 'Minecraft' : id === 'mod' ? MESSAGES.uiMods : id === 'resourcepack' ? MESSAGES.uiResourcepacks : id === 'shader' ? MESSAGES.uiShaders : MESSAGES.uiLibrary}</button>)}</div>
        <div hidden={downloadTab !== 'minecraft'}><div className="download-note"><span className="source-badge">Mojang</span><p>{MESSAGES.uiVanillaDownloadHint}</p></div><div className="install-layout"><VersionCatalog enabled={has('catalog.v1')} selected={versionId} onSelect={setVersionId} /><InstallPanel enabled={has('instances.v1')} rootId={state.rootId} versionId={versionId} /></div></div>
        <div hidden={downloadTab === 'minecraft'}><ResourceBrowser enabled={has('resources.v1') && state.page === 'downloads' && downloadTab !== 'minecraft'} kind={downloadTab === 'resourcepack' ? 'resourcepack' : downloadTab === 'shader' ? 'shader' : 'mod'} libraryOnly={downloadTab === 'library'} /></div>
      </div>
      <div hidden={state.page !== 'announcements'}><AnnouncementsPage /></div><div hidden={state.page !== 'settings'}><SettingsPage enabled={has('settings.v1')} rootsEnabled={has('roots.v1')} downloadsEnabled={has('downloads.v1')} /></div>
      <footer className="page-footer"><span>OUCL</span><span>{MESSAGES.uiFooter}</span><span>0.2.3</span></footer>
    </main></div>
  </div>;
}

