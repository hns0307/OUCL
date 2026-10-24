import { open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { guardDirectory, hasCode } from '../storage/files.js';
import type { Installation } from '../storage/installation.js';
import type { RecordEnvelope } from '../storage/records.js';
import { normalizeDataDirectory } from '../../core/path/layout.js';
import { MESSAGES } from '../../shared/locales/messages.js';
import type { RootCode, RootSelection, RootSummary } from '../../shared/contracts/roots.js';

interface Repository {
  readInstallation(): Promise<RecordEnvelope<Installation> | undefined>;
  createInstallation(value: Installation): Promise<RecordEnvelope<Installation>>;
}
/** Fixed root failure; selected paths and OS exception strings never enter IPC. */
export class RootError extends Error {
  constructor(readonly code: RootCode) { super(code); this.name = 'RootError'; }
}
/** Registers the first fixed data directory; it does not import or move an existing launcher tree. */
export class RootService {
  private choosing: Promise<RootSelection> | undefined;
  constructor(private readonly repository: Repository, private readonly protectedDirectories: readonly string[]) {}
  private label(): string { return `${MESSAGES.rootLabel} 1`; }
  /** Returns only opaque identity/label/availability, keeping the actual path in the main process. */
  async list(): Promise<{ items: RootSummary[] }> {
    const record = await this.repository.readInstallation();
    if (!record) return { items: [] };
    let available = false;
    try { await guardDirectory(record.data.dataDirectory); available = true; } catch { /* Unplugged media is listed as unavailable. */ }
    return { items: [{ rootId: record.data.rootId, label: this.label(), available }] };
  }
  /** Shares one outstanding native dialog; retries recover the already committed fixed location. */
  choose(select: () => Promise<string | undefined>): Promise<RootSelection> {
    if (this.choosing) return this.choosing;
    const pending = this.performChoice(select);
    this.choosing = pending;
    void pending.finally(() => { if (this.choosing === pending) this.choosing = undefined; }).catch(() => {});
    return pending;
  }
  private async performChoice(select: () => Promise<string | undefined>): Promise<RootSelection> {
    const existing = await this.repository.readInstallation();
    if (existing) return { selection: 'chosen', rootId: existing.data.rootId, label: this.label() };
    const selected = await select();
    if (selected === undefined) return { selection: 'cancelled' };
    let directory: string;
    try { normalizeDataDirectory(selected); directory = await guardDirectory(selected); }
    catch { throw new RootError('ROOT_OUT_OF_SCOPE'); }
    for (const protectedPath of this.protectedDirectories) {
      const protectedDirectory = await realpath(protectedPath);
      const relative = path.relative(protectedDirectory, directory);
      const inverse = path.relative(directory, protectedDirectory);
      const contains = (value: string): boolean => value === '' || value !== '..' && !value.startsWith('..' + path.sep) && !path.isAbsolute(value);
      if (contains(relative) || contains(inverse)) throw new RootError('ROOT_OUT_OF_SCOPE');
    }
    const probe = path.join(directory, `.oucl-write-probe-${randomUUID()}`);
    try {
      const handle = await open(probe, 'wx');
      try { await handle.sync(); } finally { await handle.close(); }
      await unlink(probe);
    } catch { throw new RootError('PERMISSION_DENIED'); }
    try {
      const saved = await this.repository.createInstallation({ rootId: randomUUID(), dataDirectory: directory });
      return { selection: 'chosen', rootId: saved.data.rootId, label: this.label() };
    } catch (error) {
      if (hasCode(error, 'REVISION_CONFLICT')) {
        const winner = await this.repository.readInstallation();
        if (winner) return { selection: 'chosen', rootId: winner.data.rootId, label: this.label() };
      }
      throw new RootError('ROOT_UNAVAILABLE');
    }
  }
}
