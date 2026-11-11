import { useState } from 'react';
import type { PackData } from '../shared/contracts/packs.js';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';

/** Displays a fixed-sample observation; it never offers an install action. */
export function FixedPackPreview({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<PackData>(); const [error, setError] = useState<MessageKey>();
  async function inspect(): Promise<void> {
    if (!enabled || busy || !window.oucl) return;
    setBusy(true); setError(undefined); setResult(undefined);
    try { const reply = await window.oucl.inspectFixedPack(crypto.randomUUID());
      if (reply.ok) setResult(reply.data); else setError(reply.error.messageKey);
    } catch { setError('unavailable'); } finally { setBusy(false); }
  }
  return <section className="panel"><h2>{MESSAGES.packInspectTitle}</h2><p>{MESSAGES.packInspectHint}</p>
    <button disabled={!enabled || busy} onClick={() => { void inspect(); }}>{MESSAGES.packInspectButton}</button>
    {busy && <p role="status">{MESSAGES.packInspectWaiting}</p>}
    {error && <p role="alert">{MESSAGES[error]}</p>}
    {result?.state === 'cancelled' && <p role="status">{MESSAGES.packInspectCancelled}</p>}
    {result?.state === 'preview' && <div role="status"><p>{MESSAGES.packInspectUnknown}</p>
      <p>Minecraft {result.preview.target.minecraft} · Forge {result.preview.target.loaderVersion} · Java {result.preview.target.javaMajor}</p>
      <p>{MESSAGES.packInspectMod}: FerriteCore 6.0.1 · {MESSAGES.packInspectOverride} · {MESSAGES.packInspectIsolation}</p></div>}
  </section>;
}
