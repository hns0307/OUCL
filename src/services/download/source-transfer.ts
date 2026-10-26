import { bmclapiArtifactUrl, isMirrorArtifactUrl } from '../../core/download/sources.js';
import { DEFAULT_DOWNLOAD_PREFERENCES, isDownloadPreferences } from '../../shared/contracts/download-preferences.js';
import type { DownloadPreferences } from '../../shared/contracts/download-preferences.js';
import { HttpTransfer } from './http.js';
import { ParallelHttpTransfer } from './parallel-http.js';
import { RequestBudget } from './request-budget.js';
import { DownloadError, parseTransferRecord } from './types.js';
import type { TransferCheckpoint, TransferOptions, TransferRecord } from './types.js';

/** Follows only a bounded HTTPS mirror chain. The original official URL/anchor never changes. */
export function mirrorFetch(request: typeof fetch): typeof fetch {
  return async (input, init) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (let hop = 0; hop <= 3; hop++) {
      if (!isMirrorArtifactUrl(url)) throw new DownloadError('BAD_RESPONSE');
      const response = await request(url, { ...init, redirect: 'manual', credentials: 'omit' });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location'); await response.body?.cancel().catch(() => {});
      if (!location) throw new DownloadError('BAD_RESPONSE');
      try { url = new URL(location, url).href; } catch { throw new DownloadError('BAD_RESPONSE'); }
    }
    throw new DownloadError('BAD_RESPONSE');
  };
}

/** Captures preferences per file; sources share only trusted final content, never partial validators. */
export class SourceTransfer {
  constructor(private readonly preferences: () => Readonly<DownloadPreferences> = () => DEFAULT_DOWNLOAD_PREFERENCES,
    private readonly request: typeof fetch = fetch, private readonly budget = new RequestBudget()) {}
  async run(file: string, record: TransferRecord, checkpoint: TransferCheckpoint, options: TransferOptions = {}): Promise<TransferRecord> {
    const preferences = { ...this.preferences() };
    if (!isDownloadPreferences(preferences)) throw new DownloadError('INVALID_TRANSFER');
    let current = parseTransferRecord(record);
    if (current.state !== 'partial') return current;
    const save: TransferCheckpoint = async (revision, next) => { try { await checkpoint(revision, next); } catch { throw new DownloadError('NEEDS_RECOVERY'); } current = next; };
    const route = async (source: 'official' | 'bmclapi'): Promise<void> => {
      if (current.transportSource === source && source === 'official' || current.transportSource === undefined && source === 'official') return;
      const next = { ...current }; delete next.etag; delete next.lastModified;
      await save(current.revision, parseTransferRecord({ ...next, transportSource: source, revision: current.revision + 1, bytesDone: 0, state: 'partial' }));
    };
    const mirror = preferences.source === 'bmclapi' && !options.officialOnly ? bmclapiArtifactUrl(current.url) : undefined;
    if (mirror) {
      await route('bmclapi');
      try {
        const request: typeof fetch = (_url, init) => mirrorFetch(this.request)(mirror, init);
        return await this.budget.run(new URL(mirror).hostname, options.signal, () => new HttpTransfer(request).run(file, current, save, options));
      } catch (error) {
        if (!(error instanceof DownloadError) || !['NETWORK_FAILED', 'BAD_RESPONSE', 'TIMEOUT', 'RETRY_LATER'].includes(error.code) || options.signal?.aborted) throw error;
      }
    }
    await route('official');
    try { return await new ParallelHttpTransfer(this.request, this.budget).run(file, current, save, options, preferences.connectionsPerFile); }
    catch (error) {
      if (!(error instanceof DownloadError) || error.code !== 'BAD_RESPONSE' || options.signal?.aborted) throw error;
      // All parallel lanes have exited. Re-enter the established serial validator/reset logic.
      return this.budget.run(new URL(current.url).hostname, options.signal, () => new HttpTransfer(this.request).run(file, current, save, options));
    }
  }
}
