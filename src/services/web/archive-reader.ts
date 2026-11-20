import { Worker } from 'node:worker_threads';
import { exactObject } from '../../shared/contracts/handshake.js';
import { isWebPackPreview } from '../../shared/contracts/web-extensions.js';
import { MAX_INSPECT_BYTES } from './classify.js';
import type { WebFileProof } from './classify.js';

function fileProof(value: unknown): value is WebFileProof {
  const keys = ['kind', 'size', 'sha256', 'sha512', 'sha1', 'archiveRejected'];
  const hasPreview = typeof value === 'object' && value !== null && Object.hasOwn(value, 'packPreview');
  return exactObject(value, hasPreview ? [...keys, 'packPreview'] : keys) && (!hasPreview || isWebPackPreview(value.packPreview))
    && typeof value.kind === 'string' && ['mod', 'modpack', 'resourcepack', 'shader', 'skin', 'unknown'].includes(value.kind)
    && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= MAX_INSPECT_BYTES
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.sha512 === 'string' && /^[a-f0-9]{128}$/.test(value.sha512)
    && typeof value.sha1 === 'string' && /^[a-f0-9]{40}$/.test(value.sha1) && typeof value.archiveRejected === 'boolean';
}

/** Uses one bounded worker at a time for downloaded archives. */
export class WebArchiveReader {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly program: string) {}

  read(file: string, name: string): Promise<WebFileProof | undefined> {
    const result = this.tail.then(() => this.run(file, name));
    this.tail = result.catch(() => {});
    return result;
  }

  private async run(file: string, name: string): Promise<WebFileProof | undefined> {
    const worker = new Worker(this.program, { workerData: { file, name }, resourceLimits: { maxOldGenerationSizeMb: 96 } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply: unknown = await new Promise(resolve => {
        timer = setTimeout(() => { resolve(null); }, 12000);
        worker.once('message', resolve);
        worker.once('error', () => { resolve(null); });
        worker.once('exit', () => { resolve(null); });
      });
      return fileProof(reply) ? reply : undefined;
    } finally { clearTimeout(timer); await worker.terminate().catch(() => {}); }
  }
}
