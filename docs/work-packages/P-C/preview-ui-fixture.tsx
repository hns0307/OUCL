import { createRoot } from 'react-dom/client';
import { MaintenancePreviewPanel } from '../../../src/ui/MaintenancePreviewPanel.js';
import type { ModReport } from '../../../src/shared/contracts/mods-report.js';

const file = { fileId: 'b'.repeat(64), filename: 'example.jar', enabled: true, size: 8, sha1: 'c'.repeat(40), sha256: 'd'.repeat(64),
  sha512: 'e'.repeat(128), mods: [], sourceStatus: 'unknown' as const, source: null, issues: [] };
const report: ModReport = { formatVersion: 1, instanceId: '00000000-0000-4000-8000-000000000002', instanceRevision: 1, fingerprint: 'a'.repeat(64),
  checkedAt: '2026-11-11T00:00:00.000Z', mode: 'check', localState: 'satisfied', state: 'unknown', files: [file], issues: [] };
createRoot(document.getElementById('root')!).render(<MaintenancePreviewPanel rootId="00000000-0000-4000-8000-000000000001" report={report} file={file} disabled={false} />);
