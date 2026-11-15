import { useEffect, useRef, useState } from 'react';
import type { InstanceFolderKind } from '../shared/contracts/instance-folders.js';
import { MESSAGES } from '../shared/locales/messages.js';

/** Mounted per root/instance so directory feedback cannot leak into another selection. */
export function InstanceFolders({ instanceId }: { instanceId: string }) {
  const [expanded, setExpanded] = useState(false); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function open(folder: InstanceFolderKind): Promise<void> {
    if (!window.oucl || busy) return;
    setBusy(true); setError(false);
    try { const result = await window.oucl.openInstanceFolder(instanceId, folder); if (alive.current) setError(!result.ok); }
    catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  }
  return <><button className="secondary version-settings-toggle" aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setError(false); }}>{MESSAGES.uiVersionSettings}</button>
    {expanded && <div className="version-settings"><p className="muted small">{MESSAGES.uiVersionSettingsHint}</p><div className="folder-actions">{([
      ['game', 'uiOpenGameFolder'], ['mods', 'uiOpenModsFolder'], ['saves', 'uiOpenSavesFolder'], ['resourcepacks', 'uiOpenResourcepacksFolder'],
      ['shaderpacks', 'uiOpenShaderpacksFolder'], ['screenshots', 'uiOpenScreenshotsFolder'], ['logs', 'uiOpenLogsFolder'],
    ] as const).map(([folder, label]) => <button key={folder} disabled={busy} onClick={() => { void open(folder); }}>{MESSAGES[label]}</button>)}</div>
      {error && <p className="form-error" role="alert">{MESSAGES.unavailable}</p>}</div>}
  </>;
}
