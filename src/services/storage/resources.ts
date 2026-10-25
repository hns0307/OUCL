import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isLibraryItem } from '../../shared/contracts/resources.js';
import type { LibraryItem } from '../../shared/contracts/resources.js';
import { definition } from '../objects/provenance.js';
import { isModrinthFileUrl } from '../resources/modrinth.js';
import type { DownloadSpec } from '../download/types.js';
import type { ObjectRef } from '../objects/store.js';
import { StorageError } from './files.js';

export interface ResourceRecord extends LibraryItem { spec: DownloadSpec; object?: ObjectRef }
export interface ResourceLibrary { rootId: string; items: ResourceRecord[] }
/** Fixed resource index is authoritative ownership metadata; URLs never enter public projections. */
export function parseResourceLibrary(x: unknown): ResourceLibrary {
  if (!exactObject(x, ['rootId', 'items']) || typeof x.rootId !== 'string' || !UUID_PATTERN.test(x.rootId) || !Array.isArray(x.items) || x.items.length > 512) throw new StorageError('INVALID_RECORD');
  const items = x.items.map((item: unknown): ResourceRecord => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new StorageError('INVALID_RECORD');
    const row = item as Record<string, unknown>; const { spec, object, ...summary } = row;
    if (!isLibraryItem(summary) || !exactObject(spec, ['url', 'expected', 'anchor']) || !isModrinthFileUrl(spec.url)) throw new StorageError('INVALID_RECORD');
    const canonical = definition(spec.expected, spec.anchor);
    if (canonical.anchor.kind !== 'modrinth-version' || canonical.expected.algorithm !== 'sha1' || canonical.expected.size !== summary.size || canonical.expected.digest !== summary.fileId
      || canonical.expected.provenanceId !== `modrinth:${summary.projectId}:${summary.versionId}:${canonical.expected.digest}`) throw new StorageError('INVALID_RECORD');
    if (object !== undefined && (!exactObject(object, ['digest', 'size', 'sourceKey']) || typeof object.digest !== 'string' || !/^[a-f0-9]{64}$/.test(object.digest)
      || object.size !== summary.size || typeof object.sourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(object.sourceKey))) throw new StorageError('INVALID_RECORD');
    if (summary.downloaded && !object) throw new StorageError('INVALID_RECORD');
    return { ...summary, spec: { url: spec.url, ...canonical }, ...(object === undefined ? {} : { object: object as unknown as ObjectRef }) };
  });
  if (new Set(items.map(item => item.taskId)).size !== items.length) throw new StorageError('INVALID_RECORD');
  return { rootId: x.rootId, items };
}
