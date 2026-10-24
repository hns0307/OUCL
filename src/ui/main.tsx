import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MESSAGES } from '../shared/locales/messages.js';
import { useConnection } from './state.js';
import './style.css';

/** Displays only the engineering shell's actual connection state. */
function App() {
  const { status, setStatus } = useConnection();
  useEffect(() => {
    let active = true;
    const bridge = window.oucl;
    if (!bridge) { setStatus('disconnected'); return; }
    void bridge.handshake().then(result => {
      if (active) setStatus(result.ok ? 'connected' : 'disconnected');
    }).catch(() => { if (active) setStatus('disconnected'); });
    return () => { active = false; };
  }, [setStatus]);
  return <main>
    <header><span className="brand">{MESSAGES.appName}<span className="brand-dot" /></span><span className="status" role="status" data-status={status}>{MESSAGES[status]}</span></header>
    <section className="welcome"><div className="mark" aria-hidden="true">O</div><h1>{MESSAGES.welcome}</h1><p className="subtitle">{MESSAGES.subtitle}</p><div className="card"><span className="badge" aria-hidden="true">✓</span><div><h2>{MESSAGES.foundation}</h2><p>{MESSAGES.description}</p></div></div></section>
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
