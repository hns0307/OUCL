import { parentPort, workerData } from 'node:worker_threads';
import { importEngineZip, prepareEngine } from './archive.js';

type Work = { action: 'import'; source: string; destination: string }
  | { action: 'prepare'; zip: string; workspace: string; size: number };

async function execute(work: Work): Promise<void> {
  if (work.action === 'import') await importEngineZip(work.source, work.destination);
  else await prepareEngine(work.zip, work.workspace, work.size);
}
void execute(workerData as Work).then(() => parentPort?.postMessage(true), () => parentPort?.postMessage(false));
