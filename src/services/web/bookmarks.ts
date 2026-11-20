import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import { isWebBookmark, MAX_WEB_BOOKMARKS } from '../../shared/contracts/web-extensions.js';
import type { WebBookmark } from '../../shared/contracts/web-extensions.js';
import { guardDirectory, readRegular } from '../storage/files.js';
import { visibleUrl, websiteUrl } from './policy.js';
import { WebError } from './errors.js';

/** Private versioned store. Serializes atomic replacement across windows. */
export class WebBookmarks {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}

  async read(): Promise<WebBookmark[]> {
    await guardDirectory(this.directory);
    const bytes = await readRegular(path.join(this.directory, 'bookmarks.json'), 512 * 1024);
    if (!bytes) return [];
    const raw: unknown = JSON.parse(bytes.toString('utf8'));
    if (!exactObject(raw, ['schemaVersion', 'items']) || raw.schemaVersion !== 1 || !Array.isArray(raw.items)
      || raw.items.length > MAX_WEB_BOOKMARKS || !raw.items.every(item => {
        if (!isWebBookmark(item)) return false;
        const url = websiteUrl(item.url);
        return url && visibleUrl(url) === item.url;
      }) || new Set(raw.items.map(item => item.id)).size !== raw.items.length) throw new WebError('UNAVAILABLE');
    return raw.items as WebBookmark[];
  }

  update(mutate: (current: WebBookmark[]) => WebBookmark[]): Promise<WebBookmark[]> {
    const result = this.tail.then(async () => {
      const items = mutate(await this.read());
      if (items.length > MAX_WEB_BOOKMARKS) throw new WebError('LIMIT');
      const flag = path.join(this.directory, `bookmarks-${randomUUID()}.tmp`);
      const handle = await open(flag, 'wx', 0o600);
      try {
        try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, items })); await handle.sync(); } finally { await handle.close(); }
        await guardDirectory(this.directory);
        await rename(flag, path.join(this.directory, 'bookmarks.json'));
        return items;
      } finally { await unlink(flag).catch(() => {}); }
    });
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}
