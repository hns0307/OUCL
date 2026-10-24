import { definition, sourceKey } from '../objects/provenance.js';
import type { ObjectRef } from '../objects/store.js';
import type { ObjectStore } from '../objects/store.js';
import { hasCode } from '../storage/files.js';
import { DownloadError, isArtifactUrl, parseTransferRecord } from './types.js';
import type { DownloadSpec, TransferOptions, TransferRecord } from './types.js';
import type { HttpTransfer } from './http.js';

export interface TransferJournal {
  getTransfer(key: string): Promise<TransferRecord | undefined>;
  saveTransfer(expectedRevision: number, record: TransferRecord): Promise<void>;
}

/** Runs one physical transfer per identity, independently of installer consumers and renderer subscriptions. */
export class ArtifactTransfer {
  private readonly active = new Set<string>();
  constructor(private readonly http: HttpTransfer, private readonly journal: TransferJournal, private readonly objects: ObjectStore) {}

  /** Downloads official anchored bytes, resumes a durable prefix and verifies before shared-object commit. */
  async run(spec: DownloadSpec, options: TransferOptions = {}): Promise<ObjectRef> {
    if (!isArtifactUrl(spec.url)) throw new DownloadError('INVALID_TRANSFER');
    let canonical: DownloadSpec;
    try { canonical = { url: spec.url, ...definition(spec.expected, spec.anchor) }; }
    catch { throw new DownloadError('INVALID_TRANSFER'); }
    const key = sourceKey(canonical.expected, canonical.anchor);
    if (this.active.has(key)) throw new DownloadError('TRANSFER_BUSY');
    this.active.add(key);
    let record: TransferRecord | undefined;
    try {
      if (options.signal?.aborted) throw new DownloadError('CANCELLED');
      const cached = await this.objects.lookup(canonical.expected, canonical.anchor);
      record = await this.journal.getTransfer(key);
      if (options.signal?.aborted) throw new DownloadError('CANCELLED');
      if (cached) {
        if (record?.state === 'committed' && record.objectDigest !== cached.digest) throw new DownloadError('NEEDS_RECOVERY');
        if (record?.state === 'complete') await this.journal.saveTransfer(record.revision,
          parseTransferRecord({ ...record, revision: record.revision + 1, state: 'committed', objectDigest: cached.digest }));
        options.onProgress?.(canonical.expected.size, canonical.expected.size); return cached;
      }
      if (record?.state === 'committed') throw new DownloadError('NEEDS_RECOVERY');
      let file: string;
      if (!record) {
        const staged = await this.objects.createStaging(); file = staged.file;
        record = parseTransferRecord({ ...canonical, key, stagingId: staged.id, revision: 1, bytesDone: 0, state: 'partial' });
        await this.journal.saveTransfer(0, record); // Durable identity precedes any network/file content write.
      } else {
        file = await this.objects.resumeStaging(record.stagingId);
        if (record.url !== canonical.url) {
          const base = { ...record }; delete base.etag; delete base.lastModified;
          record = parseTransferRecord({ ...base, url: canonical.url, revision: record.revision + 1, bytesDone: 0, state: 'partial' });
          await this.journal.saveTransfer(record.revision - 1, record);
        }
      }
      record = await this.http.run(file, record, (revision, next) => this.journal.saveTransfer(revision, next), options);
      if (options.signal?.aborted) throw new DownloadError('CANCELLED');
      // Once object commit begins, cancellation cannot undo shared immutable bytes/provenance.
      const object = await this.objects.commit(record.stagingId, canonical.expected, canonical.anchor);
      const committed = parseTransferRecord({ ...record, revision: record.revision + 1, state: 'committed', objectDigest: object.digest });
      await this.journal.saveTransfer(record.revision, committed);
      return object;
    } catch (error) {
      if (hasCode(error, 'HASH_MISMATCH')) {
        if (record?.state === 'complete') {
          const base = { ...record }; delete base.etag; delete base.lastModified;
          await this.journal.saveTransfer(record.revision, parseTransferRecord({ ...base, revision: record.revision + 1, bytesDone: 0, state: 'partial' }));
        }
        throw new DownloadError('HASH_MISMATCH');
      }
      if (error instanceof DownloadError) throw error;
      throw new DownloadError(hasCode(error, 'NEEDS_RECOVERY') ? 'NEEDS_RECOVERY' : 'TRANSFER_IO');
    } finally { this.active.delete(key); }
  }
}
