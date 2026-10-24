import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { catalogFailure, isCatalogRequest } from '../shared/contracts/catalog.js';
import type { CatalogData, CatalogQuery, CatalogResult } from '../shared/contracts/catalog.js';
import { CatalogError } from '../services/catalog/transport.js';

/** Validates sender and DTO before official networking or cache access. */
export async function handleCatalog(input: unknown, trusted: boolean, traceId: string, list: (query: CatalogQuery) => Promise<CatalogData>): Promise<CatalogResult> {
  const id = exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return catalogFailure(id, 'INVALID_SENDER', traceId);
  if (exactObject(input, ['contractVersion', 'requestId', 'payload']) && typeof input.contractVersion === 'number' && input.contractVersion > 1
    && isCatalogRequest({ ...input, contractVersion: 1 })) return catalogFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!isCatalogRequest(input)) return catalogFailure(id, 'INVALID_ARGUMENT', traceId);
  try { return { contractVersion: 1, requestId: id, ok: true, data: await list(input.payload) }; }
  catch (error) { return catalogFailure(id, error instanceof CatalogError ? error.code : 'CATALOG_UNAVAILABLE', traceId); }
}
