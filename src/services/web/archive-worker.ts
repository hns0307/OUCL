import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import { inspectWebFile } from './classify.js';

async function execute(): Promise<void> {
  if (!parentPort) return;
  try {
    const data: unknown = workerData;
    if (!exactObject(data, ['file', 'name']) || typeof data.file !== 'string' || !path.isAbsolute(data.file)
      || typeof data.name !== 'string' || data.name.length > 180) throw new Error('INVALID_WEB_FILE');
    parentPort.postMessage(await inspectWebFile(data.file, data.name));
  } catch { parentPort.postMessage(null); }
}

void execute();
