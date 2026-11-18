import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DistributionPreparationService } from '../src/services/distribution/preparation.js';
import type { DistributionProposal } from '../src/services/distribution/execution.js';

const binding = { rootId: randomUUID(), instanceId: randomUUID(), sourceId: 'source', packageId: 'pack', packageVersion: '1' };
const proposal = (id: string): DistributionProposal => ({
  ...binding, proposalId: id, sequence: 1, instanceRevision: 2, expiresAt: Date.now() + 10000, conflicts: [],
  changes: [{ area: 'mods', path: 'example.jar', kind: 'add', artifactId: 'private', sha256: 'a'.repeat(64), size: 1 }],
});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('prepare responds pending, isolates documents, and suppresses a late proposal after revocation', async () => {
  let deliver!: (value: DistributionProposal) => void;
  const gate = new Promise<DistributionProposal>(resolve => { deliver = resolve; });
  const cancelled: string[] = [];
  const service = new DistributionPreparationService({ prepare: async () => gate, cancel: async id => { cancelled.push(id); } });
  const owner = Symbol();
  const id = randomUUID();
  try {
    assert.equal(service.prepare(owner, id, binding).state, 'pending');
    await tick();
    assert.throws(() => service.get(Symbol(), id), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => service.prepare(owner, id, { ...binding, packageVersion: '2' }), { code: 'REQUEST_CONFLICT' });
    service.revoke(owner);
    let drained = false;
    const close = service.close().then(() => { drained = true; });
    await tick();
    assert.deepEqual(cancelled, [id]);
    assert.equal(drained, false);
    deliver(proposal(id));
    await close;
    assert.throws(() => service.get(owner, id), { code: 'UNAVAILABLE' });
  } finally {
    deliver(proposal(id));
    await service.close();
  }
});

test('confirmation reservation survives revocation and stops the preparation if admission failed', async () => {
  for (const accepted of [true, false]) {
    const cancelled: string[] = [];
    const service = new DistributionPreparationService({
      prepare: async id => proposal(id), cancel: async id => { cancelled.push(id); },
    });
    const owner = Symbol();
    const id = randomUUID();
    service.prepare(owner, id, binding);
    await tick();
    const ready = service.get(owner, id);
    assert.equal(ready.state, 'ready');
    assert.deepEqual(ready.proposal?.changes, [{ area: 'mods', path: 'example.jar', kind: 'add' }]);
    assert.throws(() => service.reserveConfirmation(owner, id, 3, 1), { code: 'REQUEST_CONFLICT' });
    const complete = service.reserveConfirmation(owner, id, 2, 1);
    assert.throws(() => service.cancel(owner, id), { code: 'CANCEL_TOO_LATE' });
    service.revoke(owner);
    const closing = service.close();
    await tick();
    assert.deepEqual(cancelled, []);
    complete(accepted);
    await closing;
    assert.deepEqual(cancelled, accepted ? [] : [id]);
  }
});
