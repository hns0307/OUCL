const { net } = require('electron');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
// Test-only native-request boundary. No real socket is opened; the fixture fetch stays explicit.
module.exports = fetcher => {
  net.request = options => {
    const request = new EventEmitter(); const controller = new globalThis.AbortController(); const headers = new globalThis.Headers(); let body = ''; let stream;
    request.setHeader = (name, value) => headers.set(name, value);
    request.write = value => { body += value; };
    request.abort = () => { controller.abort(); stream?.destroy(); };
    request.end = () => {
      void (async () => {
        const response = await fetcher(options.url, { method: options.method, headers, signal: controller.signal, redirect: 'manual', credentials: 'omit', ...(body ? { body } : {}) });
        if (controller.signal.aborted) return;
        const values = Object.fromEntries(response.headers);
        if ([301, 302, 303, 307, 308].includes(response.status)) { request.emit('redirect', response.status, options.method, response.headers.get('location'), values); return; }
        stream = response.body ? Readable.fromWeb(response.body) : Readable.from([]);
        stream.statusCode = response.status; stream.headers = values;
        request.emit('response', stream);
      })().catch(error => request.emit('error', error));
    };
    return request;
  };
};

