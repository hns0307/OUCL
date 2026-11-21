import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isPackResult, packFailure } from '../shared/contracts/packs.js';
import type { PackData, PackResult } from '../shared/contracts/packs.js';

/** Validates before opening the chooser and revalidates results before returning. */
export async function handleFixedPack(input: unknown, trusted: boolean, trace: string, run: (id: string) => Promise<PackData>): Promise<PackResult> {
  const shape = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = shape && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : trace;
  if (!trusted) return packFailure(id, 'INVALID_SENDER', trace);
  if (shape && typeof input.contractVersion === 'number' && input.contractVersion > 1) return packFailure(id, 'UNSUPPORTED_CONTRACT', trace);
  if (!shape || input.contractVersion !== 1 || input.requestId !== id || !exactObject(input.payload, [])) return packFailure(id, 'INVALID_ARGUMENT', trace);
  try {
    const result: PackResult = { contractVersion: 1, requestId: id, ok: true, data: await run(id) };
    return isPackResult(result, id) ? result : packFailure(id, 'UNAVAILABLE', trace);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return packFailure(id, code === 'INVALID_SAMPLE' ? 'FIXED_SAMPLE_MISMATCH' : code === 'CANCELLED' ? 'CANCELLED' : code === 'INVALID_SENDER' ? 'INVALID_SENDER' : code === 'TIMEOUT' ? 'TIMEOUT' : 'UNAVAILABLE', trace);
  }
}
