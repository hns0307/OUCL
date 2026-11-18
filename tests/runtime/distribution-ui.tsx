import { createRoot } from 'react-dom/client';
import { DistributionExecutionControls } from '../../src/ui/DistributionExecutionControls.js';
import { distributionExecutionFailure } from '../../src/shared/contracts/distribution-execution.js';
import type { DistributionExecutionBridge } from '../../src/shared/contracts/distribution-execution.js';

const binding = {
  rootId: '00000000-0000-4000-8000-000000000001',
  instanceId: '00000000-0000-4000-8000-000000000002',
  sourceId: 'fixture', packageId: 'pack', packageVersion: '1',
};
const taskId = '00000000-0000-4000-8000-000000000003';
const confirmations: string[] = [];
let cancellations = 0;
const root = createRoot(document.getElementById('root')!);
const bridge: DistributionExecutionBridge = {
  prepareDistributionExecution: async requestId => ({
    contractVersion: 1, requestId, ok: true,
    data: { prepareRequestId: requestId, state: 'pending', proposal: null, error: null },
  }),
  getDistributionExecutionPreparation: async id => ({
    contractVersion: 1, requestId: crypto.randomUUID(), ok: true,
    data: { prepareRequestId: id, state: 'ready', error: null, proposal: {
      ...binding, proposalId: id, sequence: 2, instanceRevision: 1, expiresAt: Date.now() + 60000,
      changes: [{ area: 'mods', path: 'example.jar', kind: 'add' }], conflicts: [],
    } },
  }),
  cancelDistributionExecutionPreparation: async () => {
    cancellations++;
    return { contractVersion: 1, requestId: crypto.randomUUID(), ok: true, data: { cancelled: true } };
  },
  confirmDistributionExecution: async (requestId, payload) => {
    confirmations.push(requestId);
    document.body.dataset.confirmationIds = confirmations.join(',');
    if (confirmations.length === 1) {
      return distributionExecutionFailure<'distribution:confirmExecution'>(requestId, 'TIMEOUT', crypto.randomUUID());
    }
    return { contractVersion: 1, requestId, ok: true, data: { proposalId: payload.proposalId, taskId,
      snapshot: { taskId, kind: 'distribution-install', state: 'queued', stage: 'queued', revision: 1, bytesDone: 0 } } };
  },
  recoverDistributionExecution: async requestId => distributionExecutionFailure<'distribution:recoverExecution'>(requestId, 'SOURCE_UNAVAILABLE', crypto.randomUUID()),
};
Object.defineProperty(window, 'oucl', { value: bridge });
root.render(<DistributionExecutionControls binding={binding} onTasks={() => {
  root.unmount();
  document.body.dataset.cancellations = String(cancellations);
}} />);
