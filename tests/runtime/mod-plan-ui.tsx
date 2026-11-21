import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResourceBrowser } from '../../src/ui/ResourceBrowser.js';
import { useLauncher } from '../../src/ui/launcher-state.js';
import '../../src/ui/desktop.css';

// Explicit UI fixture: real component/bridge/storage, with an inert resource and instance summary.
useLauncher.setState({ rootId: '00000000-0000-4000-8000-000000000001' });
function PreviewFixture() {
  const [revision, setRevision] = useState(1);
  return <main className="main-content"><button id="change-revision" onClick={() => { setRevision(2); }}>测试实例修订变化</button>
    <ResourceBrowser enabled kind="mod" libraryOnly modPlansEnabled instance={{
      instanceId: '00000000-0000-4000-8000-000000000002', displayName: 'UI fixture', mcVersionId: '1.20.1',
      isolation: 'on', state: 'ready', revision,
    }} /></main>;
}
createRoot(document.getElementById('root')!).render(<PreviewFixture />);
