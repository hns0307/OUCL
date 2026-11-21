import { nativeImage } from 'electron';
import { open } from 'node:fs/promises';
import type { ModrinthClient } from '../services/resources/modrinth.js';

/** Resolves only official project thumbnails; no renderer-controlled URL is accepted. */
export class DesktopImages {
  private readonly cache = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly lanes: Promise<void>[] = [Promise.resolve(), Promise.resolve(), Promise.resolve()];
  private lane = 0;
  constructor(private readonly client: Pick<ModrinthClient, 'iconUrl'>, private readonly transport: typeof fetch = fetch) {}
  /** Bounds and re-encodes raster thumbnails, excluding SVG, HTML and remote references. */
  static png(bytes: Buffer): string {
    if (bytes.length > 512 * 1024) throw new Error('ICON_TOO_LARGE');
    const raster = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes[0] === 255 && bytes[1] === 216
      || bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!raster) throw new Error('ICON_FORMAT');
    const image = nativeImage.createFromBuffer(bytes); const size = image.getSize();
    if (image.isEmpty() || size.width > 4096 || size.height > 4096) throw new Error('ICON_DIMENSIONS');
    return image.resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
  }
  /** Reads at most 512 KiB from a path returned by the trusted native file chooser. */
  static async local(file: string): Promise<string> {
    const handle = await open(file, 'r'); try {
      const stat = await handle.stat(); if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('ICON_TOO_LARGE');
      const bytes = Buffer.alloc(512 * 1024 + 1); let size = 0;
      while (size < bytes.length) { const read = await handle.read(bytes, size, bytes.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
      return DesktopImages.png(bytes.subarray(0, size));
    } finally { await handle.close(); }
  }
  /** Serial, deduplicated cache avoids a burst of project and thumbnail requests for a result page. */
  icon(projectId: string): Promise<string> {
    const cached = this.cache.get(projectId); if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.pending.get(projectId); if (pending) return pending;
    if (this.pending.size >= 40) return Promise.resolve('');
    const lane = this.lane++ % 3;
    const job = this.lanes[lane]!.then(async () => {
      try {
        const url = await this.client.iconUrl(projectId); if (!url) return '';
        const response = await this.transport(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5000) });
        if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > 512 * 1024) return '';
        const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
        try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 512 * 1024) throw new Error('ICON_TOO_LARGE'); chunks.push(next.value); } }
        finally { await reader.cancel().catch(() => {}); }
        return DesktopImages.png(Buffer.concat(chunks));
      } catch { return ''; }
    });
    this.lanes[lane] = job.then(() => {}, () => {}); this.pending.set(projectId, job);
    void job.then(icon => { this.cache.set(projectId, icon); if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!); }).finally(() => { this.pending.delete(projectId); }); return job;
  }
}
