import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { SkinContractError } from '../../shared/contracts/skin.js';

export interface SkinHttpRequest {
  limit: number; signal?: AbortSignal; stopAtAli?: boolean; method?: 'GET' | 'POST' | 'PUT'; headers?: Record<string, string>; body?: Buffer;
}
export interface SkinHttpResponse { status: number; headers: Headers; body: Buffer }
export type SkinTransport = (url: URL, options: SkinHttpRequest) => Promise<SkinHttpResponse>;
const blocked4 = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked4.addSubnet(network, prefix, 'ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked6.addSubnet(network, prefix, 'ipv6');
function publicIp(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked4.check(address, 'ipv4') : family === 6 && global6.check(address, 'ipv6') && !blocked6.check(address, 'ipv6');
}

/** Canonicalizes user-entered site URLs and rejects unsupported protocols, credentials and local literals. */
export function skinHttpsUrl(input: string, base?: URL): URL {
  if (!input || input.length > 2048 || /[\p{C}\\]/u.test(input)) throw new SkinContractError('INVALID_URL');
  let url: URL;
  try { url = base ? new URL(input, base) : new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : 'https://' + input); }
  catch { throw new SkinContractError('INVALID_URL'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048
    || (isIP(host) ? !publicIp(host) : !host.includes('.') || /\.(?:localhost|local|internal|home\.arpa)\.?$/i.test(host))) throw new SkinContractError('INVALID_URL');
  url.hash = '';
  return url;
}

async function publicAddress(host: string, signal: AbortSignal): Promise<{ address: string; family: number }> {
  signal.throwIfAborted();
  const direct = isIP(host);
  const addresses = direct ? [{ address: host, family: direct }] : await lookup(host, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(item => !publicIp(item.address))) throw new SkinContractError('INVALID_URL');
  return addresses.find(item => item.family === 4) ?? addresses[0]!;
}

/** Issues one bounded public HTTPS request, binding the socket to the admitted DNS answer and TLS name. */
export async function skinTransport(url: URL, options: SkinHttpRequest): Promise<SkinHttpResponse> {
  const target = skinHttpsUrl(url.href);
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const deadline = AbortSignal.timeout(10_000);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  try {
    const remote = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      void publicAddress(host, signal).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    return await new Promise((resolve, reject) => {
      const upstream = request({
        hostname: remote.address, family: remote.family, port: target.port || 443,
        path: target.pathname + target.search, ...(isIP(host) ? {} : { servername: host }),
        checkServerIdentity: (_name, certificate) => checkServerIdentity(host, certificate),
        agent: false, signal, method: options.method ?? 'GET',
        headers: { ...options.headers, host: target.host, 'accept-encoding': 'identity', 'user-agent': 'OUCL Skin Center' },
      }, incoming => {
        const status = incoming.statusCode ?? 0;
        const headers = new Headers();
        for (const [name, values] of Object.entries(incoming.headers)) if (values !== undefined) {
          for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
        }
        const ali = options.stopAtAli ? headers.get('x-authlib-injector-api-location') : undefined;
        let aliMoves = false;
        if (ali) {
          try {
            const indicated = new URL(ali, target);
            aliMoves = indicated.origin !== target.origin || indicated.pathname.replace(/\/$/, '') !== target.pathname.replace(/\/$/, '');
          } catch { aliMoves = true; }
        }
        if (status >= 300 && status <= 399 || aliMoves) {
          resolve({ status, headers, body: Buffer.alloc(0) });
          incoming.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on('error', reject);
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.limit) { reject(new SkinContractError('NETWORK_FAILED')); incoming.destroy(); }
          else chunks.push(chunk);
        });
        if (Number(headers.get('content-length')) > options.limit) { reject(new SkinContractError('NETWORK_FAILED')); incoming.destroy(); return; }
        incoming.once('end', () => resolve({ status, headers, body: Buffer.concat(chunks, size) }));
      });
      upstream.on('error', reject);
      upstream.end(options.body);
    });
  } catch (error) {
    if (error instanceof SkinContractError) throw error;
    throw new SkinContractError(options.signal?.aborted ? 'CANCELLED' : deadline.aborted ? 'TIMEOUT' : 'NETWORK_FAILED');
  }
}

/** Follows only explicitly admitted redirects on an anonymous read. Authenticated requests use one hop. */
export async function readSkinResource(send: SkinTransport, start: URL, options: SkinHttpRequest,
  allowed: (target: URL) => boolean = () => true): Promise<{ response: SkinHttpResponse; url: URL }> {
  let url = start;
  const visited = new Set<string>();
  for (let hop = 0; hop < 5; hop++) {
    if (!allowed(url) || visited.has(url.href)) throw new SkinContractError('INVALID_URL');
    visited.add(url.href);
    const response = await send(url, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url };
    const location = response.headers.get('location');
    if (!location) break;
    url = skinHttpsUrl(location, url);
  }
  throw new SkinContractError('NETWORK_FAILED');
}
