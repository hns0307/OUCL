import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { MAX_WEB_DOWNLOADS, MAX_WEB_DOWNLOAD_BYTES, webId } from '../../shared/contracts/web-extensions.js';
import type { WebDownload } from '../../shared/contracts/web-extensions.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { validateSkinPng } from '../skin/provider.js';
import type { WebArchiveReader } from './archive-reader.js';
import { MAX_INSPECT_BYTES } from './classify.js';
import type { WebFileProof } from './classify.js';
import { WebError } from './errors.js';
import { downloadName, websiteUrl } from './policy.js';
import { mapWebImportFailure, WebImports } from './imports.js';

export interface BrowserDownloadItem {
  getURLChain(): string[];
  getURL(): string;
  getTotalBytes(): number;
  getFilename(): string;
  getReceivedBytes(): number;
  setSavePath(path: string): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  onDone(listener: (state: string) => void): void;
  onUpdated(listener: (state: string) => void): void;
}

interface Record {
  data: WebDownload;
  path: string;
  item: BrowserDownloadItem | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  proof: WebFileProof | undefined;
  done: Promise<void>;
  busy: boolean;
}

/** Holds Electron downloads in a private workspace until the launcher confirms export or native import. */
export class WebDownloads {
  private readonly records = new Map<string, Record>();
  private closed = false;
  constructor(private readonly directory: string, private readonly reader: Pick<WebArchiveReader, 'read'>,
    private readonly imports: WebImports, private readonly notify: () => void) {}

  snapshots(): WebDownload[] { return [...this.records.values()].reverse().map(record => ({ ...record.data })); }

  admit(item: BrowserDownloadItem): boolean {
    const urls = item.getURLChain();
    const final = websiteUrl(item.getURL());
    const length = item.getTotalBytes();
    const active = [...this.records.values()].filter(record => record.item !== undefined).length;
    if (this.closed || !final || !urls.length || urls.length > 16 || urls.some(url => !websiteUrl(url))
      || !Number.isSafeInteger(length) || length < -1 || length > MAX_WEB_DOWNLOAD_BYTES
      || this.records.size >= MAX_WEB_DOWNLOADS || active >= 4) return false;
    const id = randomUUID();
    const output = path.join(this.directory, `${id}.bin`);
    item.setSavePath(output);
    item.pause();
    const record: Record = { data: { id, filename: downloadName(item.getFilename()), origin: final.origin, fileKind: 'unknown',
      status: 'confirmation', receivedBytes: 0, totalBytes: length > 0 ? length : null, note: null, packPreview: null, packTaskId: null },
      path: output, item, timer: undefined, proof: undefined, done: Promise.resolve(), busy: false };
    record.done = new Promise(resolve => {
      item.onDone(state => { void this.settle(record, state).finally(resolve).catch(() => {}); });
    });
    item.onUpdated(state => {
      if (!record.item) return;
      const bytes = item.getReceivedBytes();
      const total = item.getTotalBytes();
      if (bytes > MAX_WEB_DOWNLOAD_BYTES || total > MAX_WEB_DOWNLOAD_BYTES || state === 'interrupted') { item.cancel(); return; }
      if (bytes >= 0) record.data.receivedBytes = bytes;
      if (total > 0) record.data.totalBytes = total;
      this.notify();
    });
    record.timer = setTimeout(() => { if (record.item) record.item.cancel(); }, 120000);
    this.records.set(id, record); this.notify();
    return true;
  }

  private async settle(record: Record, state: string): Promise<void> {
    clearTimeout(record.timer);
    const confirmed = record.data.status === 'downloading';
    record.item = undefined; record.timer = undefined;
    if (!confirmed || state !== 'completed' || this.closed) {
      record.data.status = state === 'interrupted' ? 'failed' : 'cancelled';
      await this.removeFile(record).catch(() => {});
      this.notify();
      return;
    }
    record.data.status = 'checking'; this.notify();
    try {
      const info = await this.checkedFile(record);
      const fact = info.size > MAX_INSPECT_BYTES ? undefined : await this.reader.read(record.path, record.data.filename);
      if (fact && fact.size !== info.size) throw new WebError('UNAVAILABLE');
      record.proof = fact;
      record.data.fileKind = fact?.kind ?? 'unknown';
      record.data.packPreview = fact?.packPreview ?? null;
      record.data.receivedBytes = info.size; record.data.totalBytes = info.size;
      record.data.note = fact?.archiveRejected ? 'archiveRejected' : null;
      record.data.status = 'ready';
    } catch {
      record.data.status = 'failed';
      await this.removeFile(record).catch(() => {});
    }
    this.notify();
  }

  private async checkedFile(record: Record) {
    await guardDirectory(this.directory);
    const info = await lstat(record.path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > MAX_WEB_DOWNLOAD_BYTES) throw new WebError('UNAVAILABLE');
    return info;
  }

  private async removeFile(record: Record): Promise<void> {
    await guardDirectory(this.directory);
    try { await unlink(record.path); } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
  }

  private record(id: string): Record {
    const found = this.records.get(id);
    if (!found) throw new WebError('NOT_FOUND');
    return found;
  }

  confirm(id: string): void {
    const record = this.record(id);
    if (record.data.status !== 'confirmation' || !record.item) throw new WebError('UNAVAILABLE');
    clearTimeout(record.timer); record.timer = undefined;
    record.data.status = 'downloading'; record.item.resume(); this.notify();
  }

  cancel(id: string): void {
    const record = this.record(id);
    if (!record.item) throw new WebError('UNAVAILABLE');
    record.item.cancel();
  }

  cancelPending(): void {
    for (const record of this.records.values()) if (record.data.status === 'confirmation') record.item?.cancel();
  }

  async remove(id: string): Promise<void> {
    const record = this.record(id);
    if (record.item || record.busy || record.data.status === 'checking') throw new WebError('UNAVAILABLE');
    await this.removeFile(record);
    this.records.delete(id); this.notify();
  }

  private async withReady(id: string, run: (record: Record) => Promise<void>): Promise<void> {
    const record = this.record(id);
    if (this.closed || record.data.status !== 'ready' || record.busy) throw new WebError('UNAVAILABLE');
    record.busy = true;
    try {
      if (await this.checkedFile(record).then(info => info.size) !== record.data.totalBytes) throw new WebError('UNAVAILABLE');
      await run(record);
    } catch (error) { throw mapWebImportFailure(error); }
    finally { record.busy = false; this.notify(); }
  }

  export(id: string, selectDestination: (filename: string) => Promise<string | undefined>, trusted: () => boolean): Promise<void> {
    return this.withReady(id, async record => {
      const chosen = await selectDestination(record.data.filename);
      if (!chosen) return;
      if (!trusted() || this.closed) throw new WebError('INVALID_SENDER');
      await this.checkedFile(record);
      try { await copyFile(record.path, chosen, constants.COPYFILE_EXCL); }
      catch (error) { throw new WebError(hasCode(error, 'EEXIST') ? 'FILE_EXISTS' : 'UNAVAILABLE'); }
    });
  }

  prepareMod(id: string, trusted: () => boolean): Promise<void> {
    return this.withReady(id, async record => {
      if (!record.proof) throw new WebError('UNSUPPORTED_IMPORT');
      await this.imports.prepareMod({ proof: record.proof, file: record.path, filename: record.data.filename }, () => trusted() && !this.closed);
      record.data.note = 'resourceQueued';
    });
  }

  install(id: string, instanceId: string, revision: number, trusted: () => boolean): Promise<void> {
    return this.withReady(id, async record => {
      if (!record.proof) throw new WebError('UNSUPPORTED_IMPORT');
      await this.imports.installAddon({ proof: record.proof, file: record.path, filename: record.data.filename }, instanceId, revision,
        () => trusted() && !this.closed);
      record.data.note = 'imported';
    });
  }

  installPack(id: string, name: string, trusted: () => boolean): Promise<void> {
    return this.withReady(id, async record => {
      if (!record.proof || record.data.packTaskId) throw new WebError('UNSUPPORTED_IMPORT');
      const { taskId } = await this.imports.installPack({ proof: record.proof, file: record.path, filename: record.data.filename }, name,
        () => trusted() && !this.closed);
      if (!webId(taskId)) throw new WebError('UNAVAILABLE');
      record.data.packTaskId = taskId;
      record.data.note = 'packQueued';
    });
  }

  /** Returns a confirmed downloaded skin as bounded validated PNG bytes, without exposing its staged path. */
  async skinDraft(id: string, trusted: () => boolean): Promise<Uint8Array> {
    const record = this.record(id);
    if (this.closed || record.data.status !== 'ready' || record.busy || record.proof?.kind !== 'skin') throw new WebError('UNSUPPORTED_IMPORT');
    record.busy = true;
    try {
      await this.checkedFile(record);
      const bytes = await readRegular(record.path, 1024 ** 2);
      if (!bytes || bytes.length !== record.proof.size || createHash('sha256').update(bytes).digest('hex') !== record.proof.sha256) {
        throw new WebError('UNAVAILABLE');
      }
      validateSkinPng(bytes, 'skin');
      if (!trusted() || this.closed) throw new WebError('INVALID_SENDER');
      return Uint8Array.from(bytes);
    } catch (error) { throw mapWebImportFailure(error); }
    finally { record.busy = false; }
  }

  async close(): Promise<void> {
    this.closed = true;
    const all = [...this.records.values()];
    for (const record of all) record.item?.cancel();
    await Promise.allSettled(all.map(async record => { await record.done; await this.removeFile(record); }));
    await rmdir(this.directory).catch(() => {});
  }
}
