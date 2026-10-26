import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parseAssetIndex } from '../src/core/install/assets.js';
import { planVanillaInstall } from '../src/core/install/plan.js';
import { resolveClientVersion } from '../src/core/version/resolve.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import { assembleInstallerMetadata, rebuildPreparedInstallerPlan } from '../src/services/loaders/installer-install-metadata.js';
import { InstallerPreparationService } from '../src/services/loaders/installer-preparation.js';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { clientMappingsSpec, prepareProcessorWorkspace } from '../src/services/loaders/processor-workspace.js';

const sha1 = (body: string): string => createHash('sha1').update(body).digest('hex');
const assetsBody = JSON.stringify({ objects: {} }); const assetsSha1 = sha1(assetsBody);
const baseValue = { id: '1.20.1', mainClass: 'vanilla.Main', type: 'release', javaVersion: { majorVersion: 17 }, libraries: [],
  downloads: { client: { url: 'https://piston-data.mojang.com/client.jar', sha1: '1'.repeat(40), size: 10 },
    client_mappings: { url: `https://piston-data.mojang.com/v1/objects/${'9'.repeat(40)}/client.txt`, sha1: '9'.repeat(40), size: 40 } },
  assetIndex: { id: 'assets', url: 'https://piston-meta.mojang.com/assets.json', sha1: assetsSha1, size: Buffer.byteLength(assetsBody) } };
const baseBody = JSON.stringify(baseValue); const environment = { os: 'windows' as const, arch: 'x64' as const, osVersion: '10', features: {} };
const baseVersion = resolveClientVersion('1.20.1', { '1.20.1': baseValue }, environment); const assets = parseAssetIndex(JSON.parse(assetsBody) as unknown);
const base = { version: baseVersion, assets, plan: planVanillaInstall(baseVersion, { '1.20.1': sha1(baseBody) }, assets),
  metadataSha1ByVersion: { '1.20.1': sha1(baseBody) }, assetIndexBody: assetsBody, versionDocuments: { '1.20.1': baseBody } };

test('assembler binds extracted documents and every library to the verified installer choice', async () => {
  const tool = { name: 'net.minecraftforge:installertools:1', downloads: { artifact: { path: 'net/minecraftforge/installertools/1/installertools-1.jar',
    url: 'https://maven.minecraftforge.net/net/minecraftforge/installertools/1/installertools-1.jar', sha1: '2'.repeat(40), size: 20 } } };
  const tools = [tool, ...['jarsplitter', 'ForgeAutoRenamingTool', 'binarypatcher'].map((name, index) => ({ name: `net.minecraftforge:${name}:1${name === 'ForgeAutoRenamingTool' ? ':all' : ''}`,
    downloads: { artifact: { path: `net/minecraftforge/${name}/1/${name}-1${name === 'ForgeAutoRenamingTool' ? '-all' : ''}.jar`,
      url: `https://maven.minecraftforge.net/net/minecraftforge/${name}/1/${name}-1${name === 'ForgeAutoRenamingTool' ? '-all' : ''}.jar`, sha1: String(index + 3).repeat(40), size: index + 21 } } }))];
  const mapping = { name: 'de.oceanlabs.mcp:mcp_config:1.20.1-stamp@zip', downloads: { artifact: { path: 'de/oceanlabs/mcp/mcp_config/1.20.1-stamp/mcp_config-1.20.1-stamp.zip',
    url: 'https://maven.minecraftforge.net/de/oceanlabs/mcp/mcp_config/1.20.1-stamp/mcp_config-1.20.1-stamp.zip', sha1: '6'.repeat(40), size: 30 } } };
  const p = (jar: string, args: string[], outputs: Record<string, string> = {}) => ({ jar, classpath: [jar], args, outputs });
  const data = { MAPPINGS: { client: '[out:mappings:1@txt]' }, MOJMAPS: { client: '[out:mojmaps:1@txt]' }, MERGED_MAPPINGS: { client: '[out:merged:1@txt]' },
    BINPATCH: { client: '/data/client.lzma' }, MC_SLIM: { client: '[out:client:1:slim]' }, MC_SLIM_SHA: { client: `'${'a'.repeat(40)}'` },
    MC_EXTRA: { client: '[out:client:1:extra]' }, MC_EXTRA_SHA: { client: `'${'b'.repeat(40)}'` }, MC_SRG: { client: '[out:client:1:srg]' },
    PATCHED: { client: '[out:forge:1:client]' }, PATCHED_SHA: { client: `'${'c'.repeat(40)}'` } };
  const profileBody = JSON.stringify({ spec: 1, profile: 'forge', version: '1.20.1-forge-47.4.28', minecraft: '1.20.1', data, libraries: [...tools, mapping], processors: [
    p(tool.name, ['--task', 'MCP_DATA', '--input', `[${mapping.name}]`, '--output', '{MAPPINGS}', '--key', 'mappings']),
    p(tool.name, ['--task', 'DOWNLOAD_MOJMAPS', '--version', '1.20.1', '--side', '{SIDE}', '--output', '{MOJMAPS}']),
    p(tool.name, ['--task', 'MERGE_MAPPING', '--left', '{MAPPINGS}', '--right', '{MOJMAPS}', '--output', '{MERGED_MAPPINGS}', '--classes', '--reverse-right']),
    p(tools[1]!.name, ['--input', '{MINECRAFT_JAR}', '--slim', '{MC_SLIM}', '--extra', '{MC_EXTRA}', '--srg', '{MERGED_MAPPINGS}'], { '{MC_SLIM}': '{MC_SLIM_SHA}', '{MC_EXTRA}': '{MC_EXTRA_SHA}' }),
    p(tools[2]!.name, ['--input', '{MC_SLIM}', '--output', '{MC_SRG}', '--names', '{MERGED_MAPPINGS}', '--ann-fix', '--ids-fix', '--src-fix', '--record-fix']),
    p(tools[3]!.name, ['--clean', '{MC_SRG}', '--output', '{PATCHED}', '--apply', '{BINPATCH}']) ] });
  const versionBody = JSON.stringify({ id: '1.20.1-forge-47.4.28', inheritsFrom: '1.20.1', type: 'release', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    arguments: { game: [], jvm: [] }, libraries: [tool] });
  const digest = 'd'.repeat(40); const spec = { url: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar',
    expected: { algorithm: 'sha1' as const, digest, size: 100, provenanceId: `loader:forge:${digest}` }, anchor: { kind: 'loader-maven' as const, algorithm: 'sha256' as const, digest: 'e'.repeat(64) } };
  const catalog = { items: [{ kind: 'forge' as const, minecraftVersion: '1.20.1', loaderVersion: '47.4.28', stable: true }], evidence: {
    sourceUrl: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', sha256: 'f'.repeat(64) } };
  const result = assembleInstallerMetadata('forge', '1.20.1', '47.4.28', environment, base, catalog,
    { sourceUrl: spec.url, spec, catalogSha256: catalog.evidence.sha256 }, { digest: '7'.repeat(64), size: 100, sourceKey: sourceKey(spec.expected, spec.anchor) }, profileBody, versionBody);
  assert.equal(result.loader.libraries.length, 5); assert.equal(result.loader.libraries[0]?.spec.anchor.digest, result.loader.profileSha256);
  assert.equal(result.version.mainClass, 'cpw.mods.bootstraplauncher.BootstrapLauncher');
  const rebuilt = rebuildPreparedInstallerPlan({ ...result, plan: { ...result.plan, artifacts: [], views: [] } });
  assert.equal(rebuilt.artifacts.length, result.plan.artifacts.length);
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-installer-prepare-'));
  try {
    const object = result.loader.installer.object; const calls: string[] = [];
    const preparation = new InstallerPreparationService({ prepare: async () => base }, { catalog: async () => catalog },
      { resolve: async () => ({ sourceUrl: spec.url, spec, catalogSha256: catalog.evidence.sha256 }) });
    const prepared = await preparation.prepare('forge', '1.20.1', '47.4.28', environment, '00000000-0000-4000-8000-000000000001', {
      dataDirectory: root, objects: { lookup: async () => object },
      coordinator: { request: (_spec, options) => { calls.push(options.consumerId); return { id: options.consumerId, result: Promise.resolve(object),
        state: () => 'completed', cancel: async () => {}, pause: async () => {}, resume: async () => {} }; } },
      views: { materialize: async (_directory, relative, _spec, reference, options) => { assert.equal(options.mode, 'copy');
        return { relativePath: relative, objectDigest: reference.digest, size: reference.size, mode: 'copy' }; } },
      extractor: { run: async destination => { await writeFile(path.join(destination, 'install_profile.json'), profileBody);
        await writeFile(path.join(destination, 'version.json'), versionBody); return { files: 3, bytes: 100 }; } },
    }, new AbortController().signal);
    assert.deepEqual(prepared.metadata.loader, result.loader); assert.equal(calls.length, 1);
    assert.equal(path.dirname(prepared.workspace), path.join(await realpath(root), 'staging/loader-installers'));
    const copies: string[] = [];
    const processorPlan = await prepareProcessorWorkspace(prepared.metadata, { plan: rebuilt,
      objects: new Map(rebuilt.artifacts.map(item => [item.artifactId, { digest: '7'.repeat(64), size: item.size, sourceKey: '8'.repeat(64) }])) },
    prepared.workspace, { materialize: async (_root, relative, _spec, reference, options) => {
      copies.push(relative); assert.equal(options.mode, 'copy'); return { relativePath: relative, objectDigest: reference.digest, size: reference.size, mode: 'copy' };
    } }, { read: async input => input.file.includes('ForgeAutoRenamingTool') ? 'net.minecraftforge.fart.Main'
      : input.file.includes('jarsplitter') ? 'net.minecraftforge.jarsplitter.ConsoleTool'
        : input.file.includes('binarypatcher') ? 'net.minecraftforge.binarypatcher.ConsoleTool' : 'net.minecraftforge.installertools.ConsoleTool' }, new AbortController().signal);
    assert.equal(processorPlan.commands.length, 6); assert.equal(copies.length, tools.length + 2);
    assert.ok(copies.includes('minecraft/client.jar'));
    assert.equal(clientMappingsSpec(result).expected.digest, '9'.repeat(40));
    assert.throws(() => clientMappingsSpec({ ...result, metadataSha1ByVersion: { '1.20.1': '0'.repeat(40) } }));
  } finally { assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
  assert.throws(() => assembleInstallerMetadata('forge', '1.20.1', '47.4.28', environment, base, catalog,
    { sourceUrl: spec.url, spec, catalogSha256: '0'.repeat(64) }, { digest: '7'.repeat(64), size: 100, sourceKey: sourceKey(spec.expected, spec.anchor) }, profileBody, versionBody));
});
