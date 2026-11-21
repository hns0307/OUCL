import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { instanceRecordId, parseInstanceIndex, parseInstanceRecord, parseInstanceSummary } from '../src/services/storage/instance-records.js';
import type { InstanceMetadata, InstanceRecord, InstanceSummary } from '../src/services/storage/instance-records.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { RecordStore } from '../src/services/storage/records.js';
import { parseReply, parseStorageRequest } from '../src/services/workers/protocol.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import { restoreInstallMetadata } from '../src/services/install/installer.js';

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const worker = new URL('../src/services/workers/entry.js', import.meta.url);
const sha1 = (body: string): string => createHash('sha1').update(body).digest('hex');
function summary(revision = 1): InstanceSummary {
  return { instanceId: id(1), rootId: id(2), taskId: id(3), displayName: '社团原版', mcVersionId: '1.20.1', isolation: 'on', state: 'installing', revision };
}
function metadata(): InstanceMetadata {
  const assetIndexBody = '{"objects":{}}\n';
  const body = JSON.stringify({ id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', libraries: [],
    downloads: { client: { url: 'https://piston-data.mojang.com/objects/fixture/client.jar', sha1: 'a'.repeat(40), size: 8 } },
    assetIndex: { id: '5', url: 'https://piston-meta.mojang.com/v1/packages/fixture/5.json', sha1: sha1(assetIndexBody), size: Buffer.byteLength(assetIndexBody) } }) + '\n';
  return { versionDocuments: { '1.20.1': body }, metadataSha1ByVersion: { '1.20.1': sha1(body) }, assetIndexBody };
}
function loaderInstallMetadata(): InstanceMetadata {
  const base = metadata(); const profile = JSON.stringify({ id: 'fabric-loader-0.20.1-1.20.1', inheritsFrom: '1.20.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', arguments: { game: [], jvm: [] },
    libraries: [{ name: 'net.fabricmc:fabric-loader:0.20.1', url: 'https://maven.fabricmc.net/' }] });
  const digest = 'd'.repeat(40); const profileSha256 = createHash('sha256').update(profile).digest('hex');
  return { ...base, environment: { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} }, loader: {
    kind: 'fabric', version: '0.20.1', profileBody: profile,
    profileSourceUrl: 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.20.1/profile/json', profileSha256,
    libraries: [{ path: 'net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar', spec: {
      url: 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar',
      expected: { algorithm: 'sha1', digest, size: 32, provenanceId: `loader:fabric:${digest}` },
      anchor: { kind: 'loader-maven', algorithm: 'sha256', digest: 'e'.repeat(64) }
    } }]
  } };
}
function installerInstallMetadata(withProcessors = false): InstanceMetadata {
  const base = metadata();
  const coordinatePath = (coordinate: string): string => {
    const [body, extension = 'jar'] = coordinate.split('@'); const [group, artifact, version, classifier] = body!.split(':');
    return `${group!.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`;
  };
  const coordinates = ['net.minecraftforge:installertools:1', 'net.minecraftforge:jarsplitter:1',
    'net.minecraftforge:ForgeAutoRenamingTool:1:all', 'net.minecraftforge:binarypatcher:1', 'de.oceanlabs.mcp:mcp_config:1.20.1-stamp@zip'] as const;
  const declarations = coordinates.map((coordinate, index) => ({ name: coordinate, downloads: { artifact: { path: coordinatePath(coordinate),
    url: `https://maven.minecraftforge.net/${coordinatePath(coordinate)}`, sha1: String(index + 1).repeat(40), size: index + 20 } } }));
  const tools = [coordinates[0], coordinates[1], coordinates[2], coordinates[3]] as const;
  const p = (jar: string, args: string[], outputs: Record<string, string> = {}) => ({ jar, classpath: [jar], args, outputs });
  const data = { MAPPINGS: { client: '[out:mappings:1@txt]' }, MOJMAPS: { client: '[out:mojmaps:1@txt]' },
    MERGED_MAPPINGS: { client: '[out:merged:1@txt]' }, BINPATCH: { client: '/data/client.lzma' },
    MC_SLIM: { client: '[out:client:1:slim]' }, MC_SLIM_SHA: { client: `'${'a'.repeat(40)}'` },
    MC_EXTRA: { client: '[out:client:1:extra]' }, MC_EXTRA_SHA: { client: `'${'b'.repeat(40)}'` },
    MC_SRG: { client: '[out:client:1:srg]' }, PATCHED: { client: '[out:forge:1:client]' }, PATCHED_SHA: { client: `'${'c'.repeat(40)}'` } };
  const profileValue = { spec: 1, profile: 'forge', version: '1.20.1-forge-47.4.28', minecraft: '1.20.1', data,
    libraries: declarations, processors: [
      p(tools[0]!, ['--task', 'MCP_DATA', '--input', `[${coordinates[4]}]`, '--output', '{MAPPINGS}', '--key', 'mappings']),
      p(tools[0]!, ['--task', 'DOWNLOAD_MOJMAPS', '--version', '1.20.1', '--side', '{SIDE}', '--output', '{MOJMAPS}']),
      p(tools[0]!, ['--task', 'MERGE_MAPPING', '--left', '{MAPPINGS}', '--right', '{MOJMAPS}', '--output', '{MERGED_MAPPINGS}', '--classes', '--reverse-right']),
      p(tools[1]!, ['--input', '{MINECRAFT_JAR}', '--slim', '{MC_SLIM}', '--extra', '{MC_EXTRA}', '--srg', '{MERGED_MAPPINGS}'],
        { '{MC_SLIM}': '{MC_SLIM_SHA}', '{MC_EXTRA}': '{MC_EXTRA_SHA}' }),
      p(tools[2]!, ['--input', '{MC_SLIM}', '--output', '{MC_SRG}', '--names', '{MERGED_MAPPINGS}', '--ann-fix', '--ids-fix', '--src-fix', '--record-fix']),
      p(tools[3]!, ['--clean', '{MC_SRG}', '--output', '{PATCHED}', '--apply', '{BINPATCH}']),
    ] };
  const versionValue = { id: '1.20.1-forge-47.4.28', inheritsFrom: '1.20.1', type: 'release',
    mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher', arguments: { game: [], jvm: [] }, libraries: declarations.slice(0, 1) };
  const profileBody = JSON.stringify(profileValue); const versionBody = JSON.stringify(versionValue);
  const profileSha256 = createHash('sha256').update(profileBody).digest('hex'); const installerDigest = 'd'.repeat(40);
  const installerUrl = 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar';
  const installerSpec = { url: installerUrl, expected: { algorithm: 'sha1' as const, digest: installerDigest, size: 100, provenanceId: `loader:forge:${installerDigest}` },
    anchor: { kind: 'loader-maven' as const, algorithm: 'sha256' as const, digest: 'e'.repeat(64) } };
  const outputs = [
    ['extract-mappings', tools[0], 'net.minecraftforge.installertools.ConsoleTool', ['MAPPINGS']],
    ['download-mojang-mappings', tools[0], 'net.minecraftforge.installertools.ConsoleTool', ['MOJMAPS']],
    ['merge-mappings', tools[0], 'net.minecraftforge.installertools.ConsoleTool', ['MERGED_MAPPINGS']],
    ['split-client', tools[1], 'net.minecraftforge.jarsplitter.ConsoleTool', ['MC_SLIM', 'MC_EXTRA']],
    ['rename-client', tools[2], 'net.minecraftforge.fart.Main', ['MC_SRG']],
    ['apply-client-patches', tools[3], 'net.minecraftforge.binarypatcher.ConsoleTool', ['PATCHED']],
  ] as const;
  const processors = outputs.map(([role, tool, mainClass, keys]) => ({ role, tool, mainClass, outputs: keys.map(key => {
    const raw = data[key as keyof typeof data].client; const coordinate = raw.slice(1, -1); const pathValue = coordinatePath(coordinate);
    const upstream = `${key}_SHA` in data ? data[`${key}_SHA` as keyof typeof data].client.slice(1, -1) : undefined;
    return { path: pathValue, size: 10, sha1: upstream ?? 'f'.repeat(40), sha256: '9'.repeat(64), ...(upstream ? { upstreamSha1: upstream } : {}) };
  }) }));
  return { ...base, environment: { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} }, loader: {
    kind: 'forge', version: '47.4.28', catalogSourceUrl: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
    catalogSha256: '8'.repeat(64), installer: { sourceUrl: installerUrl, spec: installerSpec,
      object: { digest: '7'.repeat(64), size: 100, sourceKey: sourceKey(installerSpec.expected, installerSpec.anchor) } },
    profileBody, profileSha256, versionBody, versionSha256: createHash('sha256').update(versionBody).digest('hex'),
    libraries: declarations.map(item => ({ path: item.downloads.artifact.path, spec: { url: item.downloads.artifact.url,
      expected: { algorithm: 'sha1' as const, digest: item.downloads.artifact.sha1, size: item.downloads.artifact.size,
        provenanceId: `loader:forge:${item.downloads.artifact.sha1}` }, anchor: { kind: 'loader-profile' as const, algorithm: 'sha256' as const, digest: profileSha256 } } })),
    ...(withProcessors ? { processors } : {}) } };
}
function ready(revision = 1): InstanceRecord {
  const artifactId = `sha1-${'a'.repeat(40)}`;
  return { formatVersion: 2, loader: { kind: 'vanilla' }, summary: { ...summary(revision), state: 'ready' }, phase: 'ready', metadata: metadata(),
    objects: { [artifactId]: { digest: 'b'.repeat(64), size: 8, sourceKey: 'c'.repeat(64) } },
    receipts: [{ area: 'version', path: 'client.jar', artifactId, mode: 'copy' }] };
}
async function fixture(work: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-instances-'));
  try { await work(root); }
  finally { assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
}

test('instance summaries and indexes have exact bounded fields, canonical IDs and independent revisions', () => {
  assert.deepEqual(parseInstanceSummary(summary()), summary());
  assert.equal(parseInstanceSummary({ ...summary(), instanceId: id(255).toUpperCase() }).instanceId, id(255));
  assert.equal(instanceRecordId(id(255).toUpperCase()), `instance-${id(255)}`);
  assert.deepEqual(parseInstanceIndex({ items: [summary()] }), { items: [summary()] });
  for (const invalid of [{ ...summary(), extra: true }, { ...summary(), instanceId: '../file' }, { ...summary(), displayName: ' hidden' },
    { ...summary(), displayName: 'private\0name' }, { ...summary(), isolation: false }, { ...summary(), state: 'complete' }, { ...summary(), revision: 0 }]) {
    assert.throws(() => parseInstanceSummary(invalid), { code: 'INVALID_RECORD' });
  }
  assert.throws(() => instanceRecordId('../file'), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceIndex({ items: [summary(), summary()] }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceIndex({ items: Array.from({ length: 1001 }, (_, i) => ({ ...summary(), instanceId: id(i + 1) })) }), { code: 'INVALID_RECORD' });
});

test('instance phases cannot claim ready without all materialization checkpoints', () => {
  assert.deepEqual(parseInstanceRecord({ summary: summary(), phase: 'reserved' }),
    { formatVersion: 2, loader: { kind: 'vanilla' }, summary: summary(), phase: 'reserved' });
  assert.deepEqual(parseInstanceRecord(ready()), ready());
  for (const invalid of [{ summary: summary(), phase: 'ready' }, { summary: { ...summary(), state: 'ready' }, phase: 'ready' },
    { summary: summary(), phase: 'prepared' }, { summary: summary(), phase: 'downloaded', metadata: metadata() },
    { ...ready(), metadata: undefined }, { ...ready(), receipts: [] }, { ...ready(), objects: {} }, { ...ready(), arbitraryPath: 'private' }]) {
    assert.throws(() => parseInstanceRecord(invalid), { code: 'INVALID_RECORD' });
  }
  assert.equal(parseInstanceRecord({ summary: { ...summary(), state: 'failed' }, phase: 'failed' }).summary.state, 'failed');
  assert.deepEqual(parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' }, summary: summary(), phase: 'reserved' }).loader,
    { kind: 'fabric', version: '0.20.1' });
  for (const invalid of [
    { formatVersion: 3, loader: { kind: 'vanilla' }, summary: summary(), phase: 'reserved' },
    { formatVersion: 2, summary: summary(), phase: 'reserved' },
    { loader: { kind: 'vanilla' }, summary: summary(), phase: 'reserved' },
    { formatVersion: 2, loader: { kind: 'fabric' }, summary: summary(), phase: 'reserved' }
  ]) assert.throws(() => parseInstanceRecord(invalid), { code: 'INVALID_RECORD' });
});

test('instance metadata preserves original bytes and rejects mismatched keys, hashes, index bytes and foreign ancestry', () => {
  const valid = metadata(); assert.equal(parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: valid }).metadata?.assetIndexBody, valid.assetIndexBody);
  const changedBody = valid.versionDocuments['1.20.1']!.replace('"size":8', '"size":9');
  const foreignBody = valid.versionDocuments['1.20.1']!.replace('1.20.1', 'foreign');
  for (const invalid of [
    { ...valid, versionDocuments: { '1.20.1': changedBody } },
    { ...valid, metadataSha1ByVersion: {} },
    { ...valid, metadataSha1ByVersion: { ...valid.metadataSha1ByVersion, foreign: 'a'.repeat(40) } },
    { ...valid, assetIndexBody: valid.assetIndexBody.trim() },
    { ...valid, versionDocuments: { '1.20.1': foreignBody }, metadataSha1ByVersion: { '1.20.1': sha1(foreignBody) } },
    { ...valid, versionDocuments: { '1.20.1': '{bad JSON' }, metadataSha1ByVersion: { '1.20.1': sha1('{bad JSON') } },
    { ...valid, versionDocuments: { ...valid.versionDocuments, foreign: foreignBody }, metadataSha1ByVersion: { ...valid.metadataSha1ByVersion, foreign: sha1(foreignBody) } },
  ]) assert.throws(() => parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: invalid }), { code: 'INVALID_RECORD' });
});

test('instance object refs and receipts reject paths, unknown fields, conflicts and absent content identities', () => {
  const valid = ready(); const receipt = valid.receipts![0]!; const artifactId = receipt.artifactId;
  for (const invalid of [
    { ...valid, objects: { '../../foreign': valid.objects![artifactId] } },
    { ...valid, objects: { [artifactId]: { ...valid.objects![artifactId], sourceKey: 'wrong' } } },
    { ...valid, objects: { [artifactId]: { ...valid.objects![artifactId], path: 'private' } } },
    { ...valid, receipts: [{ ...receipt, path: '../player.dat' }] },
    { ...valid, receipts: [{ ...receipt, artifactId: `sha1-${'d'.repeat(40)}` }] },
    { ...valid, receipts: [receipt, { ...receipt, path: 'CLIENT.jar' }] },
    { ...valid, receipts: [{ ...receipt, path: 'folder' }, { ...receipt, path: 'folder/client.jar' }] },
    { ...valid, receipts: [{ ...receipt, path: 'folder/client.jar' }, { ...receipt, path: 'folder' }] },
    { ...valid, receipts: [{ ...receipt, mode: 'hardlink' }] },
  ]) assert.throws(() => parseInstanceRecord(invalid), { code: 'INVALID_RECORD' });
});

test('instance body and metadata budgets are checked before accepting persistent JSON', () => {
  const valid = metadata();
  assert.throws(() => parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: { ...valid, assetIndexBody: ' '.repeat(2 * 1024 ** 2 + 1) } }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ ...ready(), unknown: ' '.repeat(4 * 1024 ** 2) }), { code: 'INVALID_RECORD' });
});

test('instance metadata persists the exact bounded Windows rule environment instead of guessing it on reopen', () => {
  const input = { ...metadata(), environment: { os: 'windows' as const, arch: 'x64' as const, osVersion: '10.0.22631', features: { is_demo_user: false } } };
  assert.deepEqual(parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: input }).metadata?.environment, input.environment);
  for (const environment of [{ ...input.environment, os: 'linux' }, { ...input.environment, arch: 'x86' }, { ...input.environment, osVersion: 'private\0path' },
    { ...input.environment, features: { flag: 'true' } }, { ...input.environment, unknown: true }]) {
    assert.throws(() => parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: { ...input, environment } }), { code: 'INVALID_RECORD' });
  }
});

test('loader metadata is revalidated from original profile bytes and per-library source proofs', () => {
  const input = loaderInstallMetadata(); const record = parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: input });
  assert.deepEqual(record.metadata?.loader, input.loader);
  for (const loader of [
    { ...input.loader, profileSha256: 'f'.repeat(64) },
    { ...input.loader, profileSourceUrl: 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/latest/profile/json' },
    { ...input.loader, libraries: input.loader!.libraries.map(item => ({ ...item, path: '../bad.jar' })) },
    { ...input.loader, libraries: input.loader!.libraries.map(item => ({ ...item, spec: { ...item.spec, anchor: { kind: 'loader-profile', algorithm: 'sha256', digest: input.loader!.profileSha256 } } })) },
    { ...input.loader, libraries: input.loader!.libraries.map(item => ({ ...item, spec: { ...item.spec, anchor: { ...item.spec.anchor, kind: 'mojang-version' } } })) }
  ]) assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: { ...input, loader } }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: { ...input, environment: undefined } }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'quilt', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: input }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'vanilla' },
    summary: summary(), phase: 'prepared', metadata: input }), { code: 'INVALID_RECORD' });
});

test('installer loader metadata preserves its upstream chain and validates processor evidence', () => {
  const prepared = installerInstallMetadata();
  const parsed = parseInstanceRecord({ formatVersion: 2, loader: { kind: 'forge', version: '47.4.28' }, summary: summary(), phase: 'prepared', metadata: prepared });
  assert.equal(parsed.metadata?.loader?.kind, 'forge');
  const restored = restoreInstallMetadata(parsed); assert.equal(restored.version.mainClass, 'cpw.mods.bootstraplauncher.BootstrapLauncher');
  assert.ok(restored.plan.artifacts.some(item => item.source.kind === 'loader-profile'));
  const completed = installerInstallMetadata(true);
  const evidence = completed.loader?.kind === 'forge' ? completed.loader.processors : undefined;
  assert.equal(parseInstanceRecord({ formatVersion: 2, loader: { kind: 'forge', version: '47.4.28' }, summary: summary(), phase: 'prepared', metadata: completed })
    .metadata?.loader?.kind, 'forge');
  assert.equal(evidence?.length, 6);
  if (prepared.loader?.kind !== 'forge' || completed.loader?.kind !== 'forge' || !completed.loader.processors) assert.fail('fixture');
  for (const loader of [
    { ...prepared.loader, catalogSourceUrl: 'https://example.invalid/catalog.json' },
    { ...prepared.loader, profileSha256: '0'.repeat(64) },
    { ...prepared.loader, installer: { ...prepared.loader.installer, sourceUrl: prepared.loader.installer.sourceUrl.replace('47.4.28', '47.4.27') } },
    { ...prepared.loader, installer: { ...prepared.loader.installer, object: { ...prepared.loader.installer.object, sourceKey: '0'.repeat(64) } } },
    { ...prepared.loader, libraries: prepared.loader.libraries.map((item, index) => index ? item : { ...item, spec: { ...item.spec,
      anchor: { ...item.spec.anchor, digest: '0'.repeat(64) } } }) },
    { ...completed.loader, processors: completed.loader.processors.map((item, index) => index ? item : { ...item, mainClass: 'evil.Main' }) },
    { ...completed.loader, processors: completed.loader.processors.map((item, index) => index !== 3 ? item : { ...item,
      outputs: item.outputs.map(output => ({ ...output, upstreamSha1: '0'.repeat(40) })) }) },
  ]) assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'forge', version: '47.4.28' },
    summary: summary(), phase: 'prepared', metadata: { ...prepared, loader } }), { code: 'INVALID_RECORD' });
});

test('private instance worker commands and replies reject arbitrary records, foreign IDs and mismatched revisions', () => {
  const request = { version: 1, id: id(4), command: { kind: 'instance:set', instanceId: id(1), expectedRevision: 0, data: ready() } };
  assert.deepEqual(parseStorageRequest(request), request);
  for (const command of [{ ...request.command, instanceId: id(2) }, { ...request.command, expectedRevision: 1 },
    { ...request.command, file: 'private' }, { kind: 'instance:get', instanceId: '../file' }, { kind: 'instances:set', expectedRevision: 0, data: { arbitrary: [] } },
    { kind: 'record:set', recordId: 'instance-foreign', data: ready() }]) {
    assert.throws(() => parseStorageRequest({ ...request, command }));
  }
  const reply = { version: 1, kind: 'response', id: id(4), ok: true, instance: { schemaVersion: 1, revision: 1, data: ready() } };
  assert.deepEqual(parseReply(reply), reply);
  assert.throws(() => parseReply({ ...reply, instance: { ...reply.instance, revision: 2 } }));
  assert.throws(() => parseReply({ ...reply, instances: { schemaVersion: 1, revision: 1, data: { items: [] } } }));
});

test('real instance storage worker CAS persists through close/reopen without altering tasks or object hints', async () => fixture(async root => {
  let client = await StorageClient.open(worker, root);
  try {
    assert.equal(await client.readInstances(), undefined); assert.equal(await client.readInstance(id(1)), undefined);
    const task = await client.accept(id(2), id(3), 'install', 'a'.repeat(64));
    await client.remember('b'.repeat(64), { digest: 'c'.repeat(64), size: 8 });
    const index = await client.writeInstances(0, { items: [summary()] }); assert.equal(index.revision, 1);
    const reserved = await client.writeInstance(id(1), 0, { summary: summary(), phase: 'reserved' }); assert.equal(reserved.revision, 1);
    const prepared: InstanceRecord = { formatVersion: 2, loader: { kind: 'vanilla' }, summary: summary(2), phase: 'prepared', metadata: metadata() };
    assert.equal((await client.writeInstance(id(1), 1, prepared)).data.phase, 'prepared');
    await assert.rejects(client.writeInstance(id(1), 1, prepared), { code: 'REVISION_CONFLICT' });
    await assert.rejects(client.writeInstances(0, { items: [summary()] }), { code: 'REVISION_CONFLICT' });
    await assert.rejects(client.writeInstance(id(2), 1, prepared));
    await client.close(); client = await StorageClient.open(worker, root);
    assert.equal((await client.readInstance(id(1)))?.data.phase, 'prepared');
    assert.equal((await client.readInstances())?.data.items[0]?.state, 'installing');
    assert.equal((await client.get(id(2), task.taskId))?.taskId, task.taskId);
    assert.equal((await client.lookup('b'.repeat(64)))?.digest, 'c'.repeat(64));
    const disk = JSON.parse(await readFile(path.join(root, `${instanceRecordId(id(1))}.json`), 'utf8')) as { revision: number };
    assert.equal(disk.revision, 2);
  } finally { await client.close(); }
}));

test('instance record and index commit separately so a half-completed index is never promoted to ready', async () => fixture(async root => {
  let client = await StorageClient.open(worker, root);
  try {
    await client.writeInstances(0, { items: [summary()] }); await client.writeInstance(id(1), 0, { summary: summary(), phase: 'reserved' });
    await client.writeInstance(id(1), 1, ready(2)); await client.close(); client = await StorageClient.open(worker, root);
    assert.equal((await client.readInstances())?.data.items[0]?.state, 'installing');
    assert.equal((await client.readInstance(id(1)))?.data.phase, 'ready');
    await client.writeInstances(1, { items: [ready(2).summary] }); assert.equal((await client.readInstances())?.data.items[0]?.state, 'ready');
  } finally { await client.close(); }
}));

test('instance checkpoints reuse original JSON recovery instead of adding a parallel database schema', async () => fixture(async root => {
  const store = await RecordStore.open(root);
  try {
    await store.recover(); await store.write(instanceRecordId(id(1)), 0, { summary: summary(), phase: 'reserved' }, parseInstanceRecord);
    await assert.rejects(store.write(instanceRecordId(id(1)), 1, ready(2), parseInstanceRecord, async point => {
      if (point === 'renamed') throw new Error('injected interruption');
    }), { code: 'NEEDS_RECOVERY' });
    await store.recover(); await store.recover();
    assert.equal((await store.read(instanceRecordId(id(1)), parseInstanceRecord))?.data.phase, 'ready');
  } finally { await store.close(); }
}));

test('instance storage does not create or accept arbitrary caller-selected parent directories', async () => fixture(async root => {
  const directory = path.join(root, 'registered'); await mkdir(directory); const client = await StorageClient.open(worker, directory);
  try { await assert.rejects(client.readInstance('../../outside')); assert.equal(await client.readInstance(id(99)), undefined); }
  finally { await client.close(); }
}));
