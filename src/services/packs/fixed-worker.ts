import { createHash } from 'node:crypto';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { FIXED_CONFIG_SHA256, FIXED_PACK_SHA256, FIXED_PACK_SIZE, fixedPackPreview } from '../../core/packs/fixed-preview.js';
import { inspectModArchiveBytes } from '../install/native-archive.js';
import { guardDirectory, readRegular, StorageError } from '../storage/files.js';
import { parseFixedPackRequest } from './fixed-protocol.js';

async function run(): Promise<void> {
  if (!parentPort) throw new Error('NO_PORT');
  let file: string;
  try { file = parseFixedPackRequest(workerData).file; }
  catch { parentPort.postMessage({ version: 1, kind: 'fixed-pack-failed', code: 'WORKER_FAILED' }); return; }
  let bytes: Buffer | undefined;
  try {
    await guardDirectory(path.dirname(file));
    // Bounded independently from the exact sample size, so larger ordinary files are mismatches rather than path errors.
    bytes = await readRegular(file, 16 * 1024 ** 2);
  } catch (error) {
    const code = error instanceof StorageError && error.code === 'UNSAFE_PATH' ? 'UNSAFE_PATH' : 'READ_FAILED';
    parentPort.postMessage({ version: 1, kind: 'fixed-pack-failed', code }); return;
  }
  if (!bytes) { parentPort.postMessage({ version: 1, kind: 'fixed-pack-failed', code: 'READ_FAILED' }); return; }
  try {
    if (bytes.length !== FIXED_PACK_SIZE || createHash('sha256').update(bytes).digest('hex') !== FIXED_PACK_SHA256) throw new Error('INVALID_SAMPLE');
    const names = ['modrinth.index.json', 'overrides/config/oucl-pe-smoke.properties', 'client-overrides/config/oucl-pe-smoke.properties'];
    const archive = inspectModArchiveBytes(bytes, names, 64 * 1024 ** 2);
    if (archive.selected.length !== 3 || names.some(name => !archive.selected.some(item => item.name === name))) throw new Error('INVALID_SAMPLE');
    const config = archive.selected.find(item => item.name === names[2]);
    if (!config || config.body.length !== 14 || createHash('sha256').update(config.body).digest('hex') !== FIXED_CONFIG_SHA256) throw new Error('INVALID_SAMPLE');
    parentPort.postMessage({ version: 1, kind: 'fixed-pack-result', preview: fixedPackPreview(archive.bytes) });
  } catch {
    parentPort.postMessage({ version: 1, kind: 'fixed-pack-failed', code: 'INVALID_SAMPLE' });
  }
}
void run();
