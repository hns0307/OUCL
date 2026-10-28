import { Readable } from 'node:stream';
import type { ClientRequest, ClientRequestConstructorOptions, IncomingMessage } from 'electron';

type RequestFactory = (options: ClientRequestConstructorOptions) => ClientRequest;
/** One HTTPS hop through Electron's network service. Callers retain URL admission and redirect policy. */
export function createDesktopFetch(createRequest: RequestFactory): typeof fetch {
  return async (input, init) => {
    const original = input instanceof Request ? input : undefined;
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? original?.method ?? 'GET').toUpperCase();
    if (url.protocol !== 'https:' || url.username || url.password || !['GET', 'HEAD', 'POST'].includes(method)
      || init?.body !== undefined && typeof init.body !== 'string') throw new TypeError('NETWORK_REQUEST_REJECTED');
    const signal = init?.signal ?? original?.signal; signal?.throwIfAborted();
    const headers = new Headers(init?.headers ?? original?.headers);
    const redirect = init?.redirect ?? original?.redirect ?? 'error';
    return new Promise<Response>((resolve, reject) => {
      // No cookies or authentication state from a user's browsing session enters resource requests.
      const request = createRequest({ url: url.href, method, redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
      let incoming: Readable | undefined; let settled = false;
      const clean = (): void => { signal?.removeEventListener('abort', abort); };
      const fail = (error: Error): void => { if (!settled) { settled = true; reject(error); } };
      const abort = (): void => {
        const error = new DOMException('Request aborted', 'AbortError');
        incoming?.destroy(error); request.abort(); clean(); fail(error);
      };
      const responseHeaders = (values: Record<string, string | string[]>): Headers => {
        const result = new Headers(); for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) result.append(key, item);
        return result;
      };
      request.on('error', () => { const error = new TypeError('NETWORK_REQUEST_FAILED'); clean(); incoming?.destroy(error); fail(error); });
      request.on('login', (_info, callback) => { callback(); request.abort(); clean(); fail(new TypeError('NETWORK_AUTH_REJECTED')); });
      request.on('redirect', (status, _method, location, values) => {
        clean();
        if (redirect === 'manual') { const headers = responseHeaders(values); headers.set('location', location); settled = true; resolve(new Response(null, { status, headers })); }
        else fail(new TypeError('NETWORK_REDIRECT_REJECTED'));
        request.abort(); // Never follow implicitly, even for redirect:follow. Mirror code validates every next hop.
      });
      request.on('response', (response: IncomingMessage) => {
        // Electron IncomingMessage is backed by a Node Readable, despite its narrower public event typings.
        incoming = response as unknown as Readable; const stream = incoming;
        stream.on('error', () => {});
        if (settled || signal?.aborted) { stream.destroy(); request.abort(); return; }
        stream.once('end', clean); stream.once('close', () => { clean(); if (!stream.readableEnded) request.abort(); });
        try {
          const noBody = method === 'HEAD' || [204, 205, 304].includes(response.statusCode);
          const body = noBody ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>;
          const result = new Response(body, { status: response.statusCode, headers: responseHeaders(response.headers) });
          Object.defineProperty(result, 'url', { value: url.href }); settled = true; resolve(result);
          if (noBody) stream.resume();
        } catch { request.abort(); clean(); fail(new TypeError('NETWORK_RESPONSE_FAILED')); }
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try { headers.forEach((value, name) => request.setHeader(name, value)); if (typeof init?.body === 'string') request.write(init.body); request.end(); }
      catch { request.abort(); clean(); fail(new TypeError('NETWORK_REQUEST_FAILED')); }
    });
  };
}
