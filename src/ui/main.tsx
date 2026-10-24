import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MESSAGES } from '../shared/locales/messages.js';
import { useConnection } from './state.js';
import './style.css';
import { RootSettings } from './RootSettings.js';
import { ROOTS_CAPABILITY } from '../shared/contracts/roots.js';

/** Displays only the engineering shell's actual connection state. */
function App() {
  const { status, setStatus } = useConnection();
  const [rootsEnabled, setRootsEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    const bridge = window.oucl;
    if (!bridge) { setStatus('disconnected'); return; }
    void bridge.handshake().then(result => {
      if (active) { setStatus(result.ok ? 'connected' : 'disconnected'); setRootsEnabled(result.ok && result.data.capabilities.includes(ROOTS_CAPABILITY)); }
    }).catch(() => { if (active) setStatus('disconnected'); });
    return () => { active = false; };
  }, [setStatus]);
  return <main>
    <header><span className="brand">{MESSAGES.appName}<span className="brand-dot" /></span><span className="status" role="status" data-status={status}>{MESSAGES[status]}</span></header>
    <section className="welcome"><div className="mark" aria-hidden="true">O</div><h1>{MESSAGES.welcome}</h1><p className="subtitle">{MESSAGES.subtitle}</p><RootSettings enabled={rootsEnabled} /><p className="coming-next">{MESSAGES.nextInstall}</p></section>
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
