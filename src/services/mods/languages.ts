import path from 'node:path';
import { loaderLanguageCandidates } from '../../core/loaders/languages.js';
import type { InstanceRecord } from '../storage/instance-records.js';
import type { ModArchiveReader } from '../workers/mod-archive-reader.js';
import { ModInventoryError } from './inventory.js';

/** Rehashes the real official component object before admitting its known built-in language version. */
export class InstalledLanguageReader {
  constructor(private readonly scanner: Pick<ModArchiveReader, 'read'>) {}
  async read(dataDirectory: string, record: InstanceRecord, signal?: AbortSignal): Promise<Record<string, string>> {
    const loader = record.metadata?.loader;
    if (!loader || loader.kind !== 'forge' && loader.kind !== 'neoforge') return {};
    const candidates = loaderLanguageCandidates(loader.kind, record.summary.mcVersionId, loader.version, loader.libraries.map(library => library.path));
    const result: Record<string, string> = {};
    for (const candidate of candidates) {
      const library = loader.libraries.find(library => library.path === candidate.path)!;
      const object = record.objects?.[`sha1-${library.spec.expected.digest}`];
      if (!object || object.size !== library.spec.expected.size) throw new ModInventoryError('SCAN_FAILED');
      const file = path.join(dataDirectory, 'store/objects/sha256', object.digest.slice(0, 2), object.digest);
      const scan = await this.scanner.read(file, signal);
      if (scan.sha256 !== object.digest || scan.sha1 !== library.spec.expected.digest || scan.size !== object.size) throw new ModInventoryError('SCAN_FAILED');
      Object.assign(result, candidate.versions);
    }
    return result;
  }
}
