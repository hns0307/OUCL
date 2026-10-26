import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
const mode = path.basename((workerData as { file: string }).file);
if (mode === 'malformed.jar') { parentPort!.postMessage({ version: 1, kind: 'mod-archive-result', result: {} }); parentPort!.close(); }
else if (mode === 'crash.jar') throw new Error('PRIVATE_WORKER_PATH');
else if (mode === 'empty.jar') parentPort!.close();
else setInterval(() => {}, 1000);
