import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, realpath } from 'node:fs/promises';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { OfficialMetadataReader } from '../../src/services/catalog/transport.js';
import { CatalogService } from '../../src/services/catalog/service.js';
import { InstallMetadataService } from '../../src/services/catalog/install-metadata.js';
import { InstallerService } from '../../src/services/install/installer.js';
import { ModrinthModClient } from '../../src/services/mods/modrinth.js';
import { ModArchiveReader } from '../../src/services/workers/mod-archive-reader.js';
import { modInventoryContext } from '../../src/services/mods/context.js';
import { guardDirectory, hasCode } from '../../src/services/storage/files.js';

// Explicit test-fixture supply only. This is not the product's player-confirmed installation workflow.
const workspace = path.resolve(process.env.OUCL_LOADER_TEST_WORKSPACE ?? '');
if (path.dirname(workspace) !== path.resolve('.test-build') || !/^official-loader-[A-Za-z0-9]+$/.test(path.basename(workspace))) throw new Error('INVALID_TEST_WORKSPACE');
const kind = process.env.OUCL_LOADER_TEST_KIND;
if (kind !== 'forge' && kind !== 'neoforge') throw new Error('INVALID_TEST_KIND');
const versionId = kind === 'forge' ? 'DG5Fn9Sz' : 'x7kQWVju';
const minecraft = kind === 'forge' ? '1.20.1' : '1.21.1';
const entry = path.resolve('dist/workers/entry.cjs'); const storage = await StorageClient.open(entry, path.join(workspace, 'metadata'));
const reader = new OfficialMetadataReader(); const metadata = new InstallMetadataService(new CatalogService(reader, storage), reader);
const installer = new InstallerService(storage, entry, metadata);
try {
  const root = await storage.readInstallation();
  if (!root || root.data.dataDirectory !== path.join(workspace, 'games')) throw new Error('INVALID_TEST_ROOT');
  await installer.initialize();
  const instance = (await installer.listV2(root.data.rootId)).find(item => item.loader.kind === kind && item.state === 'ready');
  if (!instance) throw new Error('TEST_INSTANCE_MISSING');
  const checkIdle = async (): Promise<void> => {
    const current = await storage.readInstance(instance.instanceId); const sessions = await storage.readGameSessions();
    if (current?.revision !== instance.revision || sessions?.data.items.some(item => item.snapshot.instanceId === instance.instanceId
      && item.spawned && item.snapshot.state !== 'exited')) throw new Error('TEST_INSTANCE_BUSY_OR_CHANGED');
  };
  await checkIdle();
  const platform = await new ModrinthModClient().version(versionId);
  if (platform.projectId !== 'uXXizFIs' || !platform.gameVersions.includes(minecraft) || !platform.loaders.includes(kind)
    || platform.dependencies.some(item => item.type === 'required')) throw new Error('TEST_MOD_METADATA_CHANGED');
  const selected = platform.files.find(item => item.primary); if (!selected || platform.files.length !== 1) throw new Error('AMBIGUOUS_TEST_MOD');
  const object = await installer.transferResource({ url: selected.url,
    expected: { algorithm: 'sha1', digest: selected.sha1, size: selected.size, provenanceId: `modrinth:${platform.projectId}:${platform.versionId}:${selected.sha1}` },
    anchor: { kind: 'modrinth-version', algorithm: 'sha256', digest: platform.evidence.sha256 } }, randomUUID(), {});
  const objectRoot = path.join(workspace, 'games/store/objects/sha256');
  const source = await realpath(path.join(objectRoot, object.digest.slice(0, 2), object.digest));
  if (!source.startsWith(objectRoot + path.sep)) throw new Error('TEST_OBJECT_ESCAPE');
  const scanner = new ModArchiveReader(entry); const verified = await scanner.read(source);
  if (verified.sha1 !== selected.sha1 || verified.sha512 !== selected.sha512 || verified.size !== selected.size
    || !verified.archives[0]?.declarations.some(item => item.format === kind && item.mods.some(mod => mod.id === 'ferritecore'))) throw new Error('TEST_MOD_DECLARATION_MISMATCH');
  const context = await modInventoryContext(storage)(instance.instanceId); await checkIdle();
  await guardDirectory(path.dirname(context.modsDirectory));
  try { await mkdir(context.modsDirectory); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
  await guardDirectory(context.modsDirectory); const target = path.join(context.modsDirectory, selected.filename);
  try { await copyFile(source, target, constants.COPYFILE_EXCL); }
  catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
  const installed = await scanner.read(target);
  if (installed.sha512 !== selected.sha512) throw new Error('TEST_MOD_TARGET_CONFLICT');
  console.log(JSON.stringify({ event: 'test-mod-supplied', kind, instanceId: instance.instanceId, projectId: platform.projectId,
    versionId, filename: selected.filename, size: selected.size, sha256: installed.sha256, sha512: installed.sha512,
    declarations: installed.archives[0]!.declarations }));
} finally { await installer.close(); await storage.close(); }
