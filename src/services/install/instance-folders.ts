import path from 'node:path';
import { guardDirectory, hasCode } from '../storage/files.js';
import type { RecordEnvelope } from '../storage/records.js';
import type { Installation } from '../storage/installation.js';
import type { InstanceRecord } from '../storage/instance-records.js';
import type { InstanceFolderKind } from '../../shared/contracts/instance-folders.js';
import { instanceGameLayout } from './instance-files.js';
import { restoreInstallMetadata } from './installer.js';
import { ensureChildDirectory } from './instance-files.js';

interface Repository {
  readInstallation(): Promise<RecordEnvelope<Installation> | undefined>;
  readInstance(instanceId: string): Promise<RecordEnvelope<InstanceRecord> | undefined>;
}
export class InstanceFolderError extends Error {
  constructor(readonly code: 'ROOT_UNAVAILABLE' | 'INSTANCE_NOT_FOUND' | 'NEEDS_RECOVERY' | 'PERMISSION_DENIED') { super(code); this.name = 'InstanceFolderError'; }
}
/** Resolves an opaque instance to one allowlisted player directory without exposing its path. */
export class InstanceFolderService {
  constructor(private readonly storage: Repository) {}
  async resolve(instanceId: string, folder: InstanceFolderKind): Promise<string> {
    const installation = await this.storage.readInstallation(); if (!installation) throw new InstanceFolderError('ROOT_UNAVAILABLE');
    const record = await this.storage.readInstance(instanceId);
    if (!record || record.data.summary.rootId !== installation.data.rootId || record.data.phase !== 'ready') throw new InstanceFolderError('INSTANCE_NOT_FOUND');
    let layout;
    try { layout = instanceGameLayout(installation.data.dataDirectory, record.data.summary, restoreInstallMetadata(record.data)); }
    catch { throw new InstanceFolderError('NEEDS_RECOVERY'); }
    try {
      const base = await guardDirectory(layout.gameDirectory);
      if (folder === 'game') return base;
      const target = await ensureChildDirectory(base, folder); const relative = path.relative(base, target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new InstanceFolderError('NEEDS_RECOVERY');
      return target;
    } catch (error) {
      if (error instanceof InstanceFolderError) throw error;
      if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM')) throw new InstanceFolderError('PERMISSION_DENIED');
      throw new InstanceFolderError('NEEDS_RECOVERY');
    }
  }
}
