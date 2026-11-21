import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInstallerProfile } from '../src/core/loaders/installer-profile.js';

const artifact = (name: string, host = 'maven.minecraftforge.net') => {
  const [group, module, version] = name.split(':') as [string, string, string];
  const path = `${group.replaceAll('.', '/')}/${module}/${version}/${module}-${version}.jar`;
  const prefix = host === 'maven.neoforged.net' ? '/releases' : '';
  return { name, downloads: { artifact: { path, url: `https://${host}${prefix}/${path}`, sha1: 'a'.repeat(40), size: 10 } } };
};
const forge = () => {
  const tool = artifact('net.minecraftforge:installertools:1.0');
  return {
    profile: { spec: 1, profile: 'forge', version: '1.20.1-forge-47.4.28', minecraft: '1.20.1',
      data: {
        MAPPINGS: { client: '[example:mappings:1@txt]', server: '[example:mappings:1@txt]' }, MOJMAPS: { client: '[example:mojmaps:1@txt]' },
        MERGED_MAPPINGS: { client: '[example:merged:1@txt]' }, BINPATCH: { client: '/data/client.lzma' },
        MC_SLIM: { client: '[example:client:1:slim]' }, MC_EXTRA: { client: '[example:client:1:extra]' },
        MC_SRG: { client: '[example:client:1:srg]' }, PATCHED: { client: '[net.minecraftforge:forge:47.4.28:client]' },
        PATCHED_SHA: { client: "'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'" },
      },
      libraries: [tool], processors: [
        { jar: tool.name, classpath: [tool.name], args: ['--output', '{PATCHED}'], outputs: { '{PATCHED}': '{PATCHED_SHA}' } },
        { jar: tool.name, classpath: [], args: ['server'], sides: ['server'] },
      ] },
    version: { id: '1.20.1-forge-47.4.28', inheritsFrom: '1.20.1', type: 'release',
      mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher', arguments: { game: ['--launchTarget', 'forgeclient'], jvm: [] }, libraries: [tool] },
  };
};

test('Forge installer profile becomes inert client processor facts with trusted artifacts', () => {
  const input = forge(); const parsed = parseInstallerProfile('forge', '1.20.1', '47.4.28', input.profile, input.version);
  assert.equal(parsed.version.id, '1.20.1-forge-47.4.28');
  assert.equal(parsed.libraries[0]?.path, 'net/minecraftforge/installertools/1.0/installertools-1.0.jar');
  assert.deepEqual(parsed.data.BINPATCH, { kind: 'embedded', entry: 'data/client.lzma' });
  assert.deepEqual(parsed.data.PATCHED_SHA, { kind: 'literal', value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  assert.equal(parsed.processors.length, 1); assert.deepEqual(parsed.processors[0]?.outputs, { '{PATCHED}': '{PATCHED_SHA}' });
});

test('NeoForge identities and its official Maven origin remain distinct', () => {
  const input = forge(); const lib = artifact('net.neoforged.installertools:installertools:2.1.2', 'maven.neoforged.net');
  const profile = { ...input.profile, profile: 'NeoForge', version: 'neoforge-21.1.258', minecraft: '1.21.1', libraries: [lib],
    processors: [{ jar: lib.name, classpath: [], args: ['--apply', '{BINPATCH}', '--output', '{PATCHED}'] }] };
  const version = { ...input.version, id: 'neoforge-21.1.258', inheritsFrom: '1.21.1', libraries: [lib] };
  assert.equal(parseInstallerProfile('neoforge', '1.21.1', '21.1.258', profile, version).kind, 'neoforge');
});

test('installer profiles reject substituted identities, unsafe proof sources and unknown placeholders', () => {
  const input = forge();
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', { ...input.profile, version: 'other' }, input.version));
  const unsafe = forge(); unsafe.profile.libraries = [artifact('net.minecraftforge:installertools:1.0', 'example.invalid')];
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', unsafe.profile, input.version));
  const substituted = forge(); substituted.profile.libraries[0]!.downloads.artifact.url = 'https://maven.minecraftforge.net/other.jar';
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', substituted.profile, input.version));
  const unknown = forge(); unknown.profile.processors[0]!.args = ['{UNKNOWN}'];
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', unknown.profile, input.version));
});

test('server-only steps, duplicate libraries, unsafe embedded paths and partial artifacts are refused', () => {
  const input = forge(); input.profile.processors = [input.profile.processors[1]!];
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', input.profile, input.version));
  const duplicate = forge(); duplicate.profile.libraries.push(duplicate.profile.libraries[0]!);
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', duplicate.profile, input.version));
  const embedded = forge(); embedded.profile.data.BINPATCH = { client: '/data/../client.lzma' };
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', embedded.profile, input.version));
  const partial = forge(); delete (partial.profile.libraries[0]!.downloads.artifact as { sha1?: string }).sha1;
  assert.throws(() => parseInstallerProfile('forge', '1.20.1', '47.4.28', partial.profile, input.version));
});
