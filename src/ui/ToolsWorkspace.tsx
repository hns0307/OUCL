import { useState } from 'react';
import { Toolbox } from './Toolbox.js';
import { OnlineToolsPanel } from './OnlineToolsPanel.js';
import { DistributionPanel } from './DistributionPanel.js';
import { MESSAGES } from '../shared/locales/messages.js';

/** Fixed feature tabs; remote content and privileged read-only preview remain separate components. */
export function ToolsWorkspace({ onlineEnabled, distributionEnabled, rootId, instanceId }: { onlineEnabled: boolean; distributionEnabled: boolean; rootId: string | undefined; instanceId: string | undefined }) {
  const [tab, setTab] = useState<'local' | 'online' | 'distribution'>('local');
  return <><div className="tabs tools-tabs">{(['local', 'online', 'distribution'] as const).map(value => <button key={value} aria-pressed={tab === value} onClick={() => { setTab(value); }}>{MESSAGES[value === 'local' ? 'localToolsTitle' : value === 'online' ? 'onlineToolsTitle' : 'distributionTitle']}</button>)}</div>
    <div hidden={tab !== 'local'}><Toolbox /></div>
    {tab === 'online' && <OnlineToolsPanel enabled={onlineEnabled} />}
    {tab === 'distribution' && <DistributionPanel key={`${rootId}:${instanceId}`} enabled={distributionEnabled} rootId={rootId} instanceId={instanceId} />}
  </>;
}
