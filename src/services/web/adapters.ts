import type { WebTab } from '../../shared/contracts/web-extensions.js';

export interface WebAdapter {
  id: NonNullable<WebTab['adapter']>;
  matches(url: URL): boolean;
  capabilities: readonly ('verifiedModDownload')[];
  attach?(tabId: string): void;
  detach?(tabId: string): void;
}

const MODRINTH: WebAdapter = {
  id: 'modrinth',
  matches: url => url.origin === 'https://modrinth.com' || url.origin === 'https://cdn.modrinth.com',
  capabilities: ['verifiedModDownload'],
};

/** Registry receives only built-in adapters. Page content receives no adapter or preload. */
export class WebAdapterRegistry {
  constructor(private readonly adapters: readonly WebAdapter[] = [MODRINTH]) {
    if (new Set(adapters.map(adapter => adapter.id)).size !== adapters.length) throw new Error('DUPLICATE_WEB_ADAPTER');
  }

  match(url: URL | undefined): WebAdapter | undefined {
    if (!url) return;
    return this.adapters.find(adapter => adapter.matches(url));
  }

  change(tabId: string, previous: WebAdapter | undefined, next: WebAdapter | undefined): void {
    if (previous === next) return;
    previous?.detach?.(tabId);
    next?.attach?.(tabId);
  }
}
