import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MESSAGES } from '../shared/locales/messages.js';
import { useConnection } from './state.js';
import './style.css';
import { RootSettings } from './RootSettings.js';
import { ROOTS_CAPABILITY } from '../shared/contracts/roots.js';
import { CATALOG_CAPABILITY } from '../shared/contracts/catalog.js';
import { VersionCatalog } from './VersionCatalog.js';
import { InstallPanel } from './InstallPanel.js';
import { INSTANCES_CAPABILITY, TASKS_CAPABILITY } from '../shared/contracts/instances.js';
import { ProfileSetup } from './ProfileSetup.js';

/** Presents the actual root/catalog/installation services through the narrow sandboxed bridge. */
function App() {
  const { status, setStatus } = useConnection();
  const [rootsEnabled, setRootsEnabled] = useState(false);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [profilesEnabled, setProfilesEnabled] = useState(false); const [, setAccountId] = useState<string | undefined>();
  const [installEnabled, setInstallEnabled] = useState(false); const [rootId, setRootId] = useState<string | undefined>(); const [versionId, setVersionId] = useState<string | undefined>();
  useEffect(() => {
    let active = true;
    const bridge = window.oucl;
    if (!bridge) { setStatus('disconnected'); return; }
    void bridge.handshake().then(result => {
      if (active) setProfilesEnabled(result.ok && ['java.v1', 'accounts.v1', 'settings.v1'].every(item => result.data.capabilities.includes(item)));
      if (active) { setStatus(result.ok ? 'connected' : 'disconnected'); setRootsEnabled(result.ok && result.data.capabilities.includes(ROOTS_CAPABILITY)); setCatalogEnabled(result.ok && result.data.capabilities.includes(CATALOG_CAPABILITY)); setInstallEnabled(result.ok && result.data.capabilities.includes(INSTANCES_CAPABILITY) && result.data.capabilities.includes(TASKS_CAPABILITY)); }
    }).catch(() => { if (active) setStatus('disconnected'); });
    return () => { active = false; };
  }, [setStatus]);
  return <main>
    <header><span className="brand">{MESSAGES.appName}<span className="brand-dot" /></span><span className="status" role="status" data-status={status}>{MESSAGES[status]}</span></header>
    <section className="welcome launcher"><h1>{MESSAGES.downloadTitle}</h1><p className="subtitle">{MESSAGES.subtitle}</p><RootSettings enabled={rootsEnabled} onRootChange={setRootId} />
      <ProfileSetup enabled={profilesEnabled} onAccount={setAccountId} />
      <div className="install-layout"><VersionCatalog enabled={catalogEnabled} selected={versionId} onSelect={setVersionId} /><InstallPanel enabled={installEnabled} rootId={rootId} versionId={versionId} /></div>
    </section>
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
