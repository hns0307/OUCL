import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { InstallerLibrary, InstallerProfile } from '../src/core/loaders/types.js';
import { planInstallerProcessors } from '../src/services/loaders/processor-plan.js';

const root = path.resolve('.test-build/processor-plan');
const lib = (coordinate: string, pathValue: string): InstallerLibrary => ({ coordinate, path: pathValue,
  url: 'https://maven.minecraftforge.net/' + pathValue, sha1: 'a'.repeat(40), size: 1 });
function forge(): InstallerProfile {
  const tools = ['net.minecraftforge:installertools:1.4.1', 'net.minecraftforge:jarsplitter:1.1.4',
    'net.minecraftforge:ForgeAutoRenamingTool:0.1.22:all', 'net.minecraftforge:binarypatcher:1.1.1'];
  const mapping = 'de.oceanlabs.mcp:mcp_config:1.20.1-stamp@zip';
  const libraries = [...tools, mapping].map((name, index) => lib(name, `group/item/${index}/item-${index}.jar`));
  const item = (tool: string, args: string[], outputs: Record<string, string> = {}) => ({ tool, classpath: [tool], arguments: args, outputs });
  return { kind: 'forge', minecraftVersion: '1.20.1', loaderVersion: '47.4.28',
    version: { id: 'id', type: 'release', mainClass: 'Main' }, libraries,
    data: {
      MAPPINGS: { kind: 'artifact', coordinate: 'out:mappings:1', path: 'out/mappings/1/mappings.txt' },
      MOJMAPS: { kind: 'artifact', coordinate: 'out:mojmaps:1', path: 'out/mojmaps/1/mojmaps.txt' },
      MERGED_MAPPINGS: { kind: 'artifact', coordinate: 'out:merged:1', path: 'out/merged/1/merged.txt' },
      BINPATCH: { kind: 'embedded', entry: 'data/client.lzma' },
      MC_SLIM: { kind: 'artifact', coordinate: 'out:client:1:slim', path: 'out/client/1/client-1-slim.jar' },
      MC_SLIM_SHA: { kind: 'literal', value: 'b'.repeat(40) },
      MC_EXTRA: { kind: 'artifact', coordinate: 'out:client:1:extra', path: 'out/client/1/client-1-extra.jar' },
      MC_EXTRA_SHA: { kind: 'literal', value: 'c'.repeat(40) },
      MC_SRG: { kind: 'artifact', coordinate: 'out:client:1:srg', path: 'out/client/1/client-1-srg.jar' },
      PATCHED: { kind: 'artifact', coordinate: 'out:forge:1:client', path: 'out/forge/1/forge-1-client.jar' },
      PATCHED_SHA: { kind: 'literal', value: 'd'.repeat(40) },
    }, processors: [
      item(tools[0]!, ['--task', 'MCP_DATA', '--input', `[${mapping}]`, '--output', '{MAPPINGS}', '--key', 'mappings']),
      item(tools[0]!, ['--task', 'DOWNLOAD_MOJMAPS', '--version', '1.20.1', '--side', '{SIDE}', '--output', '{MOJMAPS}']),
      item(tools[0]!, ['--task', 'MERGE_MAPPING', '--left', '{MAPPINGS}', '--right', '{MOJMAPS}', '--output', '{MERGED_MAPPINGS}', '--classes', '--reverse-right']),
      item(tools[1]!, ['--input', '{MINECRAFT_JAR}', '--slim', '{MC_SLIM}', '--extra', '{MC_EXTRA}', '--srg', '{MERGED_MAPPINGS}'],
        { '{MC_SLIM}': '{MC_SLIM_SHA}', '{MC_EXTRA}': '{MC_EXTRA_SHA}' }),
      item(tools[2]!, ['--input', '{MC_SLIM}', '--output', '{MC_SRG}', '--names', '{MERGED_MAPPINGS}', '--ann-fix', '--ids-fix', '--src-fix', '--record-fix']),
      item(tools[3]!, ['--clean', '{MC_SRG}', '--output', '{PATCHED}', '--apply', '{BINPATCH}']),
    ] };
}
const mainClasses = {
  'net.minecraftforge:installertools:1.4.1': 'net.minecraftforge.installertools.ConsoleTool',
  'net.minecraftforge:jarsplitter:1.1.4': 'net.minecraftforge.jarsplitter.ConsoleTool',
  'net.minecraftforge:ForgeAutoRenamingTool:0.1.22:all': 'net.minecraftforge.fart.Main',
  'net.minecraftforge:binarypatcher:1.1.1': 'net.minecraftforge.binarypatcher.ConsoleTool',
};

test('expands controlled commands into a private workspace and retains upstream proofs', () => {
  const plan = planInstallerProcessors(forge(), { workspace: root, installerFile: path.join(root, 'installer', 'installer.jar'),
    minecraftJar: path.resolve('.test-build/client.jar'), mainClasses });
  assert.equal(plan.commands.length, 6);
  assert.equal(plan.commands[0]?.arguments[3], path.join(root, 'libraries/group/item/4/item-4.jar'));
  assert.equal(plan.commands[0]?.arguments[5], path.join(root, 'libraries/out/mappings/1/mappings.txt'));
  assert.equal(plan.commands[5]?.arguments[5], path.join(root, 'installer/data/client.lzma'));
  assert.deepEqual(plan.commands[3]?.outputs.map(item => item.expectedSha1), ['b'.repeat(40), 'c'.repeat(40)]);
  assert.equal(plan.commands[5]?.outputs[0]?.expectedSha1, 'd'.repeat(40));
});

test('rejects manifest entry substitution, missing libraries and workspace escape', () => {
  assert.throws(() => planInstallerProcessors(forge(), { workspace: root, installerFile: path.join(root, 'installer.jar'),
    minecraftJar: path.resolve('client.jar'), mainClasses: { ...mainClasses, 'net.minecraftforge:binarypatcher:1.1.1': 'evil.Main' } }));
  const missing = forge(); missing.libraries = missing.libraries.filter(item => item.coordinate !== missing.processors[0]?.tool);
  assert.throws(() => planInstallerProcessors(missing, { workspace: root, installerFile: path.join(root, 'installer.jar'), minecraftJar: path.resolve('client.jar'), mainClasses }));
  assert.throws(() => planInstallerProcessors(forge(), { workspace: root, installerFile: path.resolve('outside.jar'), minecraftJar: path.resolve('client.jar'), mainClasses }));
});
