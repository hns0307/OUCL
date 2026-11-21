import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProcessorMainClass, requireProcessorMainClass } from '../src/core/loaders/processor-manifest.js';
import { parseProcessorManifestReply, parseProcessorManifestRequest } from '../src/services/workers/processor-manifest-protocol.js';

test('manifest parser reads one main-section class and continuation lines', () => {
  assert.equal(parseProcessorMainClass(Buffer.from('Manifest-Version: 1.0\r\nMain-Class: net.minecraftforge.\r\n installertools.ConsoleTool\r\n\r\nName: later\r\nMain-Class: evil.Main\r\n')),
    'net.minecraftforge.installertools.ConsoleTool');
  assert.throws(() => parseProcessorMainClass(Buffer.from('Manifest-Version: 1.0\n')));
  assert.throws(() => parseProcessorMainClass(Buffer.from('Main-Class: good.Main\nMain-Class: evil.Main\n')));
  assert.throws(() => parseProcessorMainClass(Buffer.from('Main-Class: bad/class\n')));
});

test('loader and role freeze the expected processor entry point', () => {
  assert.equal(requireProcessorMainClass('forge', 'rename-client', 'net.minecraftforge.fart.Main'), 'net.minecraftforge.fart.Main');
  assert.equal(requireProcessorMainClass('neoforge', 'rename-client', 'net.neoforged.art.Main'), 'net.neoforged.art.Main');
  assert.throws(() => requireProcessorMainClass('neoforge', 'rename-client', 'net.minecraftforge.fart.Main'));
});

test('processor manifest worker protocol rejects paths, extra fields and malformed replies', () => {
  const valid = { version: 1 as const, kind: 'processor-manifest' as const, file: process.platform === 'win32' ? 'C:\\stage\\tool.jar' : '/stage/tool.jar',
    sha256: 'a'.repeat(64), size: 10 };
  assert.deepEqual(parseProcessorManifestRequest(valid), valid);
  assert.throws(() => parseProcessorManifestRequest({ ...valid, file: 'relative.jar' }));
  assert.throws(() => parseProcessorManifestRequest({ ...valid, command: 'run' }));
  const reply = parseProcessorManifestReply({ version: 1, kind: 'processor-manifest-result', mainClass: 'safe.Main' });
  assert.equal(reply.kind === 'processor-manifest-result' ? reply.mainClass : undefined, 'safe.Main');
  assert.throws(() => parseProcessorManifestReply({ version: 1, kind: 'processor-manifest-result', mainClass: 'bad/Main' }));
});
