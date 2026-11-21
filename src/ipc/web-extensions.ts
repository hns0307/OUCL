import { randomUUID } from 'node:crypto';
import { exactObject } from '../shared/contracts/handshake.js';
import { isWebAction, isWebResult, webFailure, webId } from '../shared/contracts/web-extensions.js';
import type { WebAction, WebResult, WebSnapshot } from '../shared/contracts/web-extensions.js';
import { WebError } from '../services/web/errors.js';

export interface WebEndpoint {
  run(action: WebAction, trusted: () => boolean): Promise<WebSnapshot>;
}

/** Uses the main document's sender authorization before and after each service action. */
export async function handleWebExtensions(input: unknown, trusted: () => boolean, resolve: () => Promise<WebEndpoint>): Promise<WebResult> {
  const valid = exactObject(input, ['contractVersion', 'requestId', 'action']);
  const id = valid && webId(input.requestId) ? input.requestId : randomUUID();
  if (!trusted()) return webFailure(id, 'INVALID_SENDER');
  if (valid && typeof input.contractVersion === 'number' && input.contractVersion > 1) return webFailure(id, 'UNSUPPORTED_CONTRACT');
  if (!valid || input.requestId !== id || input.contractVersion !== 1 || !isWebAction(input.action)) return webFailure(id, 'INVALID_ARGUMENT');
  try {
    const endpoint = await resolve();
    if (!trusted()) return webFailure(id, 'INVALID_SENDER');
    const data = await endpoint.run(input.action, trusted);
    if (!trusted()) return webFailure(id, 'INVALID_SENDER');
    const reply = { contractVersion: 1, requestId: id, ok: true, data };
    return isWebResult(reply, id) ? reply : webFailure(id, 'UNAVAILABLE');
  } catch (error) {
    return webFailure(id, !trusted() ? 'INVALID_SENDER' : error instanceof WebError ? error.code : 'UNAVAILABLE');
  }
}
