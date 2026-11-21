import { createServer } from 'node:http';
import { link, symlink, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = fileURLToPath(new URL('./evidence/permission/.test-build/', import.meta.url));
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'fixture-'));
const source = path.join(directory, 'source.jar'); await writeFile(source, 'inert-fixture');
const results = {};
for (const [label, operation] of [
  ['hardLink', async () => { const target = path.join(directory, 'linked.jar'); await link(source, target); return await readFile(target, 'utf8') === 'inert-fixture'; }],
  ['symbolicLink', async () => { const target = path.join(directory, 'symbolic.jar'); await symlink(source, target); return await readFile(target, 'utf8') === 'inert-fixture'; }],
]) {
  try { results[label] = { ok: await operation() }; }
  catch (error) { results[label] = { ok: false, code: error.code }; }
}
const server = createServer((_request, response) => { response.end('local-fixture'); });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(5000) });
  results.loopback = { ok: await response.text() === 'local-fixture' };
} catch (error) { results.loopback = { ok: false, code: error.cause?.code ?? error.code ?? error.name }; }
finally { server.closeAllConnections(); await new Promise(resolve => { server.close(resolve); }); }
console.log(JSON.stringify({ platform: process.platform, scope: 'independent inert files and own loopback server only', results }, null, 2));
