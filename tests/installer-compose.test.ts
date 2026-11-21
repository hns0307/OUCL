import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseAssetIndex } from '../src/core/install/assets.js';
import type { InstallerLibrary, InstallerProfile } from '../src/core/loaders/types.js';
import { composeInstallerInstall } from '../src/services/loaders/installer-compose.js';

const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');
const assetBody = JSON.stringify({ objects: {} }); const assetSha1 = sha1(assetBody);
const base = { id: '1.20.1', mainClass: 'vanilla.Main', type: 'release', javaVersion: { majorVersion: 17 },
  downloads: { client: { url: 'https://piston-data.mojang.com/client.jar', sha1: '1'.repeat(40), size: 10 } },
  assetIndex: { id: 'assets', url: 'https://piston-meta.mojang.com/index.json', sha1: assetSha1, size: Buffer.byteLength(assetBody) },
  libraries: [], arguments: { game: ['vanilla'], jvm: [] } };
const baseBody = JSON.stringify(base);
const library = (coordinate: string, index: number): InstallerLibrary => ({ coordinate, path: `net/example/item/${index}/item-${index}.jar`,
  url: `https://maven.minecraftforge.net/net/example/item/${index}/item-${index}.jar`, sha1: String(index + 2).repeat(40), size: index + 20 });
function profile(): InstallerProfile {
  const tools = ['net.minecraftforge:installertools:1', 'net.minecraftforge:jarsplitter:1', 'net.minecraftforge:ForgeAutoRenamingTool:1:all', 'net.minecraftforge:binarypatcher:1'];
  const mapping = 'de.oceanlabs.mcp:mcp_config:1.20.1-stamp@zip'; const libraries = [...tools.map(library), library(mapping, 4)];
  const p = (tool: string, args: string[], outputs: Record<string, string> = {}) => ({ tool, classpath: [tool], arguments: args, outputs });
  return { kind: 'forge', minecraftVersion: '1.20.1', loaderVersion: '47.4.28', libraries, data: {},
    version: { id: '1.20.1-forge-47.4.28', inheritsFrom: '1.20.1', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
      arguments: { game: ['forge'], jvm: [] }, libraries: [{ name: tools[0]!, downloads: { artifact: { ...libraries[0]!, path: libraries[0]!.path } } }] },
    processors: [
      p(tools[0]!, ['--task', 'MCP_DATA', '--input', `[${mapping}]`, '--output', '{MAPPINGS}', '--key', 'mappings']),
      p(tools[0]!, ['--task', 'DOWNLOAD_MOJMAPS', '--version', '1.20.1', '--side', '{SIDE}', '--output', '{MOJMAPS}']),
      p(tools[0]!, ['--task', 'MERGE_MAPPING', '--left', '{MAPPINGS}', '--right', '{MOJMAPS}', '--output', '{MERGED_MAPPINGS}', '--classes', '--reverse-right']),
      p(tools[1]!, ['--input', '{MINECRAFT_JAR}', '--slim', '{MC_SLIM}', '--extra', '{MC_EXTRA}', '--srg', '{MERGED_MAPPINGS}'],
        { '{MC_SLIM}': '{MC_SLIM_SHA}', '{MC_EXTRA}': '{MC_EXTRA_SHA}' }),
      p(tools[2]!, ['--input', '{MC_SLIM}', '--output', '{MC_SRG}', '--names', '{MERGED_MAPPINGS}', '--ann-fix', '--ids-fix', '--src-fix', '--record-fix']),
      p(tools[3]!, ['--clean', '{MC_SRG}', '--output', '{PATCHED}', '--apply', '{BINPATCH}']),
    ] };
}

test('installer composition adds processor libraries without polluting launch classpath', () => {
  const selected = profile(); const result = composeInstallerInstall({ baseVersionDocuments: { '1.20.1': baseBody },
    baseMetadataSha1ByVersion: { '1.20.1': sha1(baseBody) }, assets: parseAssetIndex(JSON.parse(assetBody) as unknown),
    profile: selected, profileSha256: 'a'.repeat(64), environment: { os: 'windows', arch: 'x64', osVersion: '10', features: {} } });
  assert.equal(result.version.mainClass, 'cpw.mods.bootstraplauncher.BootstrapLauncher');
  assert.equal(result.plan.artifacts.filter(item => item.source.kind === 'loader-profile').length, selected.libraries.length);
  assert.equal(result.plan.views.filter(item => item.area === 'libraries').length, selected.libraries.length);
  assert.deepEqual(result.plan.classpath, [selected.libraries[0]!.path]);
  assert.equal(result.plan.artifacts.find(item => item.sha1 === selected.libraries[4]!.sha1)?.source.digest, 'a'.repeat(64));
});

test('installer composition refuses a non-policy processor chain and duplicate loader version', () => {
  const selected = profile(); selected.processors.pop();
  const input = { baseVersionDocuments: { '1.20.1': baseBody }, baseMetadataSha1ByVersion: { '1.20.1': sha1(baseBody) },
    assets: parseAssetIndex(JSON.parse(assetBody) as unknown), profile: selected, profileSha256: 'a'.repeat(64),
    environment: { os: 'windows' as const, arch: 'x64' as const, osVersion: '10', features: {} } };
  assert.throws(() => composeInstallerInstall(input));
  const valid = profile(); assert.throws(() => composeInstallerInstall({ ...input, profile: valid,
    baseVersionDocuments: { ...input.baseVersionDocuments, [valid.version.id]: baseBody } }));
});
