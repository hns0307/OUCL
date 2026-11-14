import { createHash } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { HashPool } from '../../src/services/workers/hash-pool.js';
import { ObjectStore } from '../../src/services/objects/store.js';

const [base, point] = process.argv.slice(2);
if (!base || !point || !process.send) throw new Error('INVALID_FIXTURE');
const metadata = path.join(base, 'metadata'); const storeRoot = path.join(base, 'store');
await mkdir(metadata); await mkdir(storeRoot);
const entry = new URL('../../src/services/workers/entry.js', import.meta.url);
const client = await StorageClient.open(entry, metadata); const hashes = new HashPool(entry);
const store = await ObjectStore.open(storeRoot, client, hashes);
const timeout = setTimeout(() => { process.exit(74); }, 20000);
process.on('message', message => {
  if (message !== 'exit-without-close') return;
  void (async () => {
    if (point !== 'open') {
      const bytes = Buffer.from('object owner checkpoint fixture'); const staged = await store.createStaging(); await writeFile(staged.file, bytes);
      await store.commit(staged.id, { algorithm: 'sha1', digest: createHash('sha1').update(bytes).digest('hex'), size: bytes.length, provenanceId: 'fixture:owner-checkpoint' },
        { kind: 'mojang-version', algorithm: 'sha1', digest: 'a'.repeat(40) }, async current => {
          if (current === point) { process.send!({ kind: 'checkpoint', point: current }, () => { process.exit(73); }); await new Promise<void>(() => {}); }
        });
      throw new Error('CHECKPOINT_NOT_REACHED');
    }
    clearTimeout(timeout); process.send!({ kind: 'exiting', point, storeHeld: !!store, metadataHeld: !!client }, () => { process.exit(73); });
  })().catch(error => { process.stderr.write(String(error)); process.exit(1); });
});
process.send({ kind: 'ready', marker: await readFile(path.join(storeRoot, 'objects.owner.lock'), 'utf8') });
