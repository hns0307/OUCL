import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ToolsWorkspace } from '../src/ui/ToolsWorkspace.js';
import type { DistributionBridge, DistributionQuery, DistributionResult, DistributionSummary } from '../src/shared/contracts/distribution-preview.js';
import { distributionFailure } from '../src/shared/contracts/distribution-preview.js';
import type { OnlineToolsBridge, OnlineToolsData, OnlineToolsResult } from '../src/shared/contracts/online-tools.js';
import '../src/ui/desktop.css';
import '../src/ui/interaction.css';

const ROOT = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-000000000002';
const B = '00000000-0000-4000-8000-000000000003';
let configured = false; let revision = 0; let closeCount = 0; let cancelCount = 0;
let snapshot: OnlineToolsData['snapshot'] = { revision: 0, phase: 'closed' };
let retryResolve: ((value: OnlineToolsResult) => void) | undefined;
let cancelReject: (() => void) | undefined;
const pending: Array<{ id: string; query: DistributionQuery; resolve(value: DistributionResult): void }> = [];
let update: (() => void) | undefined;
function tools(): OnlineToolsData { return { tools: configured ? [{ toolId: 'synthetic-tool', title: '合成在线工具' }] : [], snapshot: { ...snapshot } }; }
function online(id = ROOT): OnlineToolsResult { return { contractVersion: 1, requestId: id, ok: true, data: tools() }; }
function summary(query: DistributionQuery): DistributionSummary {
  return { sourceId: query.sourceId, packageId: query.packageId, packageVersion: query.packageVersion, instanceId: query.instanceId, revision: 1,
    readOnly: true, receiptStatus: 'missing', totalFiles: 2, truncated: false,
    ownership: [{ area: 'mods', path: 'local.jar', ownership: 'local-discovered' }, { area: 'config', path: 'player.json', ownership: 'user-overridden' }],
    changes: [], conflicts: [{ area: 'config', path: 'player.json', code: 'CHANGED' }] };
}
// Synthetic bridge only: no production preload, services, network, keys or player files are involved.
const bridge: DistributionBridge & OnlineToolsBridge = {
  onlineToolState: async () => online(),
  openOnlineTool: async id => { snapshot = { revision: ++revision, phase: 'ready', toolId: 'synthetic-tool' }; return online(id); },
  retryOnlineTool: id => new Promise(resolve => { retryResolve = value => resolve({ ...value, requestId: id }); update?.(); }),
  closeOnlineTool: async id => { closeCount++; snapshot = { revision: ++revision, phase: 'closed' }; update?.(); return online(id); },
  distributionSources: async () => ({ contractVersion: 1, requestId: ROOT, ok: true, data: { sources: configured ? [{ sourceId: 'synthetic-source' }] : [] } }),
  previewDistribution: (id, query) => new Promise(resolve => { pending.push({ id, query, resolve }); update?.(); }),
  cancelDistributionPreview: async id => {
    cancelCount++; const item = pending.find(entry => entry.id === id);
    if (item?.query.packageId === 'cancel-race-a') return new Promise<DistributionResult>(resolve => {
      cancelReject = () => { resolve(distributionFailure(id, 'UNTRUSTED_DISTRIBUTION', ROOT)); }; update?.();
    });
    if (item && item.query.packageId !== 'old-pack') { pending.splice(pending.indexOf(item), 1); item.resolve(distributionFailure(id, 'CANCELLED', ROOT)); }
    update?.(); return { contractVersion: 1, requestId: id, ok: true, data: { cancelled: Boolean(item) } };
  },
};
Object.defineProperty(window, 'oucl', { value: bridge, configurable: true });

function Fixture() {
  const [epoch, setEpoch] = useState(0); const [instanceId, setInstance] = useState(A); const [, tick] = useState(0);
  update = () => { tick(value => value + 1); };
  function settle(instance: string): void {
    for (const item of pending.filter(entry => entry.query.instanceId === instance)) {
      pending.splice(pending.indexOf(item), 1); item.resolve({ contractVersion: 1, requestId: item.id, ok: true, data: { preview: summary(item.query) } });
    }
    update?.();
  }
  return <main style={{ padding: 20, maxWidth: 1000, margin: 'auto', minWidth: 0 }}>
    <h1>OUCL 扩展组件验证夹具</h1><p>真实 React 组件；合成 bridge 和实例，不连接生产 IPC、网络或玩家目录。</p>
    <div className="save-row" style={{ flexWrap: 'wrap' }}>
      <button id="fixture-configure" onClick={() => { configured = true; setEpoch(value => value + 1); }}>启用合成记录</button>
      <button id="fixture-switch" onClick={() => { setInstance(B); }}>切到合成实例 B</button>
      <button id="fixture-settle-a" onClick={() => { settle(A); }}>返回 A 旧回执</button>
      <button id="fixture-settle-b" onClick={() => { settle(B); }}>返回 B 当前回执</button>
      <button id="fixture-settle-retry" onClick={() => { retryResolve?.({ contractVersion: 1, requestId: ROOT, ok: true, data: { tools: tools().tools, snapshot: { revision: 1000, phase: 'ready', toolId: 'synthetic-tool' } } }); retryResolve = undefined; update?.(); }}>返回旧在线回执</button>
      <button id="fixture-reject-cancel" onClick={() => { cancelReject?.(); cancelReject = undefined; update?.(); }}>返回旧取消失败</button>
    </div>
    <output id="fixture-state">{JSON.stringify({ configured, instanceId, closeCount, cancelCount, pending: pending.map(item => item.query.packageId), retryPending: Boolean(retryResolve) })}</output>
    <ToolsWorkspace key={epoch} onlineEnabled distributionEnabled rootId={ROOT} instanceId={instanceId} />
  </main>;
}
const root = document.getElementById('root'); if (root) createRoot(root).render(<Fixture />);
