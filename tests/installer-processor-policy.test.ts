import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceInstallerProcessorPolicy } from '../src/core/loaders/processor-policy.js';
import type { InstallerLibrary, InstallerLoaderKind, InstallerProfile } from '../src/core/loaders/types.js';

function profile(kind: InstallerLoaderKind): InstallerProfile {
  const minecraftVersion = kind === 'forge' ? '1.20.1' : '1.21.1';
  const namespace = kind === 'forge' ? 'net.minecraftforge' : 'net.neoforged.installertools';
  const mapping = kind === 'forge' ? `de.oceanlabs.mcp:mcp_config:${minecraftVersion}-stamp@zip`
    : `net.neoforged:neoform:${minecraftVersion}-stamp@zip`;
  const names = kind === 'forge'
    ? [`${namespace}:installertools:1.4.1`, `${namespace}:jarsplitter:1.1.4`, `${namespace}:ForgeAutoRenamingTool:0.1.22:all`, `${namespace}:binarypatcher:1.1.1`]
    : [`${namespace}:installertools:2.1.2`, `${namespace}:jarsplitter:2.1.2`, 'net.neoforged:AutoRenamingTool:2.0.3:all', `${namespace}:binarypatcher:2.1.2:fatjar`];
  const libraries: InstallerLibrary[] = [...names, mapping].map((coordinate, index) => ({
    coordinate, path: `library-${index}.jar`, url: `https://example.invalid/library-${index}.jar`, sha1: 'a'.repeat(40), size: 1,
  }));
  const processor = (tool: string, arguments_: string[], outputs: Record<string, string> = {}) =>
    ({ tool, classpath: [tool], arguments: arguments_, outputs });
  return { kind, minecraftVersion, loaderVersion: kind === 'forge' ? '47.4.28' : '21.1.258',
    version: { id: 'id', type: 'release', mainClass: 'Main' }, libraries, data: {}, processors: [
      processor(names[0]!, ['--task', 'MCP_DATA', '--input', `[${mapping}]`, '--output', '{MAPPINGS}', '--key', 'mappings']),
      processor(names[0]!, ['--task', 'DOWNLOAD_MOJMAPS', '--version', minecraftVersion, '--side', '{SIDE}', '--output', '{MOJMAPS}']),
      processor(names[0]!, ['--task', 'MERGE_MAPPING', '--left', '{MAPPINGS}', '--right', '{MOJMAPS}', '--output', '{MERGED_MAPPINGS}',
        '--classes', ...(kind === 'neoforge' ? ['--fields', '--methods'] : []), '--reverse-right']),
      processor(names[1]!, ['--input', '{MINECRAFT_JAR}', '--slim', '{MC_SLIM}', '--extra', '{MC_EXTRA}', '--srg', '{MERGED_MAPPINGS}'],
        kind === 'forge' ? { '{MC_SLIM}': '{MC_SLIM_SHA}', '{MC_EXTRA}': '{MC_EXTRA_SHA}' } : {}),
      processor(names[2]!, ['--input', '{MC_SLIM}', '--output', '{MC_SRG}', '--names', '{MERGED_MAPPINGS}',
        '--ann-fix', '--ids-fix', '--src-fix', '--record-fix']),
      processor(names[3]!, ['--clean', '{MC_SRG}', '--output', '{PATCHED}', '--apply', '{BINPATCH}']),
    ] };
}

test('accepts only the frozen Forge and NeoForge six-step client chains', () => {
  assert.deepEqual(enforceInstallerProcessorPolicy(profile('forge')).map(item => item.role), [
    'extract-mappings', 'download-mojang-mappings', 'merge-mappings', 'split-client', 'rename-client', 'apply-client-patches',
  ]);
  assert.equal(enforceInstallerProcessorPolicy(profile('neoforge'))[5]?.tool,
    'net.neoforged.installertools:binarypatcher:2.1.2:fatjar');
});

test('rejects task injection, reordering, unknown tools and invented upstream output proof', () => {
  const injected = profile('forge'); injected.processors[0]!.arguments[1] = 'BUNDLER_EXTRACT';
  assert.throws(() => enforceInstallerProcessorPolicy(injected));
  const reordered = profile('forge'); [reordered.processors[0], reordered.processors[1]] = [reordered.processors[1]!, reordered.processors[0]!];
  assert.throws(() => enforceInstallerProcessorPolicy(reordered));
  const unknown = profile('neoforge'); unknown.processors[5]!.tool = 'evil:binarypatcher:1:fatjar';
  assert.throws(() => enforceInstallerProcessorPolicy(unknown));
  const invented = profile('neoforge'); invented.processors[5]!.outputs = { '{PATCHED}': "'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'" };
  assert.throws(() => enforceInstallerProcessorPolicy(invented));
});

test('requires the mapping input to be one of the profile verified libraries', () => {
  const missing = profile('forge'); missing.libraries.pop();
  assert.throws(() => enforceInstallerProcessorPolicy(missing));
});
