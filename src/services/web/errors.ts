import type { WebErrorCode } from '../../shared/contracts/web-extensions.js';

/** Public failures are fixed codes, independent of remote responses and local paths. */
export class WebError extends Error {
  constructor(readonly code: WebErrorCode) { super(code); this.name = 'WebError'; }
}
