import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const base = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(base, '../..');
const s = createRequire(import.meta.url)(path.join(base, 'modules.cjs'));
const source = await readFile(path.join(repository, 'src/shared/contracts/instances.ts'), 'utf8');
const errorCodes = [...source.matchAll(/\b([A-Z_]+): \{ category:/g)].map(match => match[1]);
assert.ok(errorCodes.length > 30);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const errors = errorCodes.map(code => s.instanceFailure(randomUUID(), code, randomUUID()).error);
const error = errors.sort((a, b) => bytes(b) - bytes(a))[0];
const rootId = randomUUID(), instanceId = randomUUID(), max = Number.MAX_SAFE_INTEGER;
const rows = Array.from({ length: 2000 }, (_, index) => ({ instanceId, instanceRevision: max, task: {
  taskId: randomUUID(), kind: index < 1000 ? 'mod-check' : 'mod-install', state: 'needsRecovery', stage: 'needsRecovery',
  revision: max, bytesDone: max, bytesTotal: max, error: structuredClone(error),
} }));
assert.ok(rows.every(row => s.isTaskSnapshot(row.task)));
const cursor = randomUUID(), publicSnapshot = { items: rows, nextCursor: cursor };
const page = { items: rows.slice(1000, 1100), nextCursor: cursor };
const request = { contractVersion: 1, requestId: randomUUID(), payload: { instanceId, kinds: ['mod-check','mod-install'], limit: 100 } };
assert.ok(s.isTargetResult({ contractVersion: 1, requestId: request.requestId, ok: true, data: page }, request));
const privateRows = rows.map(row => ({ instanceId, instanceRevision: max, task: { taskId: row.task.taskId, ownerId: rootId,
  kind: row.task.kind, execution: { state: 'needsRecovery', attempt: max, lastSequence: max, revision: max - 1, bytesDone: max, bytesTotal: max } } }));
const privateResult = { rootId, rootRevision: max, items: privateRows };
assert.equal(s.parseReply({ version: 1, kind: 'response', id: randomUUID(), ok: true, modTargets: privateResult }).modTargets.items.length, 2000);
const result = { status: 'BOUNDED_UNREACHABLE_BYTE_THRESHOLDS', domainCounts: { checks: 1000, installs: 1000 },
  publicSnapshot: { upperBytes: bytes(publicSnapshot), limitBytes: 1024 ** 2, remainingBytes: 1024 ** 2 - bytes(publicSnapshot) },
  publicPage: { schemaValid: true, bytes: bytes(page), note: '100 rows is public result max; adapter whole-snapshot check uses 2000 rows' },
  privateResult: { schemaValid: true, upperBytes: bytes(privateResult), limitBytes: 2 * 1024 ** 2, remainingBytes: 2 * 1024 ** 2 - bytes(privateResult) },
  maximumError: { code: error.code, bytes: bytes(error), enumeratedFixedCodes: errorCodes.length },
  proof: [
    'Canonical ordinary DTO JSON.stringify: keys exact; UUID ASCII fixed36; kind max11; state/stage max13 (needsRecovery); nonnegative safe integers max16 decimal digits.',
    'Public optional bytesTotal/error are both present, numbers maximal-width, fixed error catalog exhaustively sized with trace UUID; arrays limited2000 whole-snapshot/100 returned page.',
    'Private execution six fields include all optional fields, numbers maximal-width, task owner UUID fixed36; no arbitrary strings or private error object.',
    '1000 rows each kind matches per-domain inventory limits; mod-install has 2 more ASCII characters than mod-check. The generic schema maxima overestimate actual check-service bytesDone=0 and failure-code projections.',
    'As both maximal-width valid-schema constructions fall below their size guards, exact limit or limit+1 cannot be reached by canonical valid domain DTOs under current cardinality/schema constraints.',
    'These are defensive guards, not supported payload-size promises. Whitespace, extra fields, oversized UUIDs, toJSON methods, duplicate IDs or >2000 rows are not canonical product-generated valid DTOs and cannot demonstrate a legal-domain byte boundary.',
  ] };
assert.ok(result.publicSnapshot.upperBytes < result.publicSnapshot.limitBytes);
assert.ok(result.privateResult.upperBytes < result.privateResult.limitBytes);
await writeFile(path.join(base, 'byte-bounds.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
