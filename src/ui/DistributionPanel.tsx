import { useEffect, useRef, useState } from 'react';
import { DISTRIBUTION_ID } from '../shared/contracts/distribution-preview.js';
import type { ContentOwnership, DistributionSummary } from '../shared/contracts/distribution-preview.js';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';

const OWNERSHIP: Record<ContentOwnership, MessageKey> = { 'package-managed': 'ownershipPackage', 'user-added': 'ownershipUser', 'local-discovered': 'ownershipLocal', 'user-overridden': 'ownershipOverride', 'ownership-conflict': 'ownershipConflict' };
const CHANGES = { add: 'distributionAdd', replace: 'distributionReplace', remove: 'distributionRemove' } as const;
const CONFLICTS = { EXISTS: 'distributionConflictExists', UNMANAGED: 'distributionConflictUnmanaged', CHANGED: 'distributionConflictChanged' } as const;
/** Reads only the chosen source/package/version. There is deliberately no install or update action. */
export function DistributionPanel({ enabled, rootId, instanceId }: { enabled: boolean; rootId: string | undefined; instanceId: string | undefined }) {
  const [sources, setSources] = useState<Array<{ sourceId: string }>>(); const [sourceId, setSourceId] = useState('');
  const [packageId, setPackageId] = useState(''); const [packageVersion, setPackageVersion] = useState('');
  const [preview, setPreview] = useState<DistributionSummary>(); const [error, setError] = useState<MessageKey>(); const [busy, setBusy] = useState(false);
  const alive = useRef(false); const request = useRef<string | undefined>(undefined);
  useEffect(() => {
    alive.current = true; const bridge = window.oucl;
    if (enabled && bridge) void bridge.distributionSources().then(result => { if (!alive.current) return;
      if (result.ok && 'sources' in result.data) { setSources(result.data.sources); setSourceId(result.data.sources[0]?.sourceId ?? ''); } else if (!result.ok) setError(result.error.messageKey);
    }).catch(() => { if (alive.current) setError('unavailable'); });
    return () => { alive.current = false; if (request.current && bridge) void bridge.cancelDistributionPreview(request.current).catch(() => {}); };
  }, [enabled]);
  async function inspect(): Promise<void> {
    const bridge = window.oucl; if (!bridge || !rootId || !instanceId || busy) return;
    const id = crypto.randomUUID(); request.current = id; setBusy(true); setError(undefined); setPreview(undefined);
    try { const result = await bridge.previewDistribution(id, { rootId, instanceId, sourceId, packageId, packageVersion });
      if (!alive.current || request.current !== id) return;
      if (result.ok && 'preview' in result.data) setPreview(result.data.preview); else if (!result.ok) setError(result.error.messageKey);
    } catch { if (alive.current && request.current === id) setError('unavailable'); }
    finally { if (alive.current && request.current === id) { request.current = undefined; setBusy(false); } }
  }
  async function cancel(): Promise<void> {
    const id = request.current; if (!id || !window.oucl) return;
    try { const result = await window.oucl.cancelDistributionPreview(id); if (alive.current && request.current === id && !result.ok) setError(result.error.messageKey); }
    catch { if (alive.current && request.current === id) setError('unavailable'); }
  }
  return <section className="panel distribution-panel"><h2>{MESSAGES.distributionTitle}</h2><p>{MESSAGES.distributionHint}</p>
    {!enabled ? <p role="status">{MESSAGES.unavailable}</p> : !sources ? <p role="status">{MESSAGES.connecting}</p> : sources.length === 0 ? <p role="status">{MESSAGES.distributionUnconfigured}</p> : <>
      {!rootId || !instanceId ? <p>{MESSAGES.distributionSelectInstance}</p> : <form onSubmit={event => { event.preventDefault(); void inspect(); }}><fieldset disabled={busy}>
        <label>{MESSAGES.distributionSource}<select value={sourceId} onChange={event => { setSourceId(event.target.value); setPreview(undefined); }}>{sources.map(source => <option key={source.sourceId}>{source.sourceId}</option>)}</select></label>
        <label>{MESSAGES.distributionPackage}<input maxLength={64} value={packageId} onChange={event => { setPackageId(event.target.value); setPreview(undefined); }} /></label>
        <label>{MESSAGES.distributionVersion}<input maxLength={64} value={packageVersion} onChange={event => { setPackageVersion(event.target.value); setPreview(undefined); }} /></label>
        <button disabled={!DISTRIBUTION_ID.test(packageId) || !DISTRIBUTION_ID.test(packageVersion) || !sourceId}>{MESSAGES.distributionPreview}</button>
      </fieldset></form>}
    </>}
    {busy && <button className="secondary" onClick={() => { void cancel(); }}>{MESSAGES.distributionCancel}</button>}
    {error && <p className="form-error" role="alert">{MESSAGES[error]}</p>}
    {preview && <div><p>{preview.packageId} · {preview.packageVersion}</p><p>{MESSAGES[preview.receiptStatus === 'missing' ? 'distributionReceiptMissing' : 'distributionReceiptLocal']}</p>
      <h3>{MESSAGES.distributionConflicts} ({preview.conflicts.length})</h3><ul>{preview.conflicts.map(row => <li key={`${row.area}/${row.path}`}>{row.area}/{row.path} · {MESSAGES[CONFLICTS[row.code]]}</li>)}</ul>
      <h3>{MESSAGES.distributionChanges} ({preview.changes.length})</h3>{preview.changes.length === 0 && <p>{MESSAGES.distributionNoChanges}</p>}<ul>{preview.changes.map(row => <li key={`${row.area}/${row.path}`}>{MESSAGES[CHANGES[row.kind]]} · {row.area}/{row.path}</li>)}</ul>
      <h3>{MESSAGES.distributionFiles} ({preview.totalFiles})</h3>{preview.truncated && <p>{MESSAGES.distributionPartial}</p>}<ul>{preview.ownership.map(row => <li key={`${row.area}/${row.path}`}>{row.area}/{row.path} · {MESSAGES[OWNERSHIP[row.ownership]]}</li>)}</ul>
    </div>}
  </section>;
}
