import { parentPort, workerData } from 'node:worker_threads';
import { createExecution } from '../../src/core/task/machine.js';

const port = parentPort!;
const mode = (workerData as { directory: string }).directory;
let released = false;
const waiting: string[] = [];
port.on('message', (request: { id: string; command: { kind: string; ownerId: string } }) => {
  if (mode === 'crash') throw new Error('PRIVATE_WORKER_STACK_MUST_NOT_ESCAPE');
  if (request.command.kind === 'close') { port.postMessage({ version: 1, kind: 'response', id: request.id, ok: true }); port.close(); }
  else if (request.command.kind === 'accept') setTimeout(() => {
    port.postMessage({ version: 1, kind: 'response', id: request.id, ok: true,
      task: { taskId: '00000000-0000-4000-8000-000000000009', ownerId: request.command.ownerId, kind: 'download', execution: createExecution() } });
    released = true;
    for (const id of waiting) port.postMessage({ version: 1, kind: 'response', id, ok: true });
  }, 1500);
  else if (released) port.postMessage({ version: 1, kind: 'response', id: request.id, ok: true });
  else waiting.push(request.id);
});
port.postMessage({ version: 1, kind: 'ready' });
