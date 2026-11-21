import { BlockList, isIP } from 'node:net';

const LOCAL_LABELS = ['localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'home.arpa', 'test', 'invalid'];

/** Only public DNS HTTPS names can be entered into a tab or confirmed from a popup. */
export function websiteUrl(value: string, addHttps = false): URL | undefined {
  const input = value.trim();
  if (!input || input.length > 4096 || /[\s\\\p{C}]/u.test(input)) return;
  try {
    const url = new URL(addHttps && !/^[a-z][a-z0-9+.-]*:/i.test(input) ? `https://${input}` : input);
    const host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 4096
      || !host.includes('.') || host.endsWith('.') || isIP(host) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i.test(host)
      || LOCAL_LABELS.some(label => host === label || host.endsWith(`.${label}`))) return;
    return url;
  } catch { return; }
}

/** Where no content fetch is involved, snapshots and bookmarks omit transient tokens in query strings and fragments. */
export function visibleUrl(url: URL): string {
  return url.origin + url.pathname;
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

/** An address preflight complements Chromium authorization. Chromium owns the actual connection. */
export function publicResolvedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

type Resolve = (host: string) => Promise<readonly string[]>;
interface CacheEntry { result: Promise<boolean>; expiresAt: number }

/** Coalesces in-flight requests for one hostname and issues a short-lived DNS screening result. */
export class BrowserDnsScreen {
  private readonly cache = new Map<string, CacheEntry>();
  private active = 0;
  constructor(private readonly resolve: Resolve) {}
  check(host: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.cache.get(host);
    if (cached && cached.expiresAt > now) return cached.result;
    if (this.active >= 32) return Promise.resolve(false);
    for (const [key, value] of this.cache) if (value.expiresAt <= now) this.cache.delete(key);
    if (this.cache.size >= 256) return Promise.resolve(false);
    this.active++;
    const result = resolveWithin(this.resolve(host)).finally(() => { this.active--; });
    this.cache.set(host, { result, expiresAt: now + 12000 });
    return result;
  }
}

async function resolveWithin(query: Promise<readonly string[]>): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([query, new Promise<readonly string[]>(resolve => {
      timeout = setTimeout(() => { resolve([]); }, 3000);
    })]);
    return addresses.length > 0 && addresses.length <= 64 && addresses.every(publicResolvedAddress);
  } catch { return false; }
  finally { clearTimeout(timeout); }
}

/** Returns the domain to screen for every networking resource, including secure WebSockets. */
export function websiteRequestHost(url: string, resourceType: string): string | undefined {
  if (resourceType === 'webSocket' && url.startsWith('wss://')) return websiteUrl(`https://${url.slice(6)}`)?.hostname;
  return websiteUrl(url)?.hostname;
}

export function websiteLabel(value: string, max: number): string {
  return value.replace(/[\p{C}]/gu, ' ').trim().slice(0, max);
}

/** Discards remote path separators, Windows device names, and invalid save names. */
export function downloadName(value: string): string {
  const safe = websiteLabel(value, 180).replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '');
  return !safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? 'download.bin' : safe;
}
