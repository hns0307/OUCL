import { lstat, mkdir, mkdtemp, open, readlink, readdir, rename, rm, symlink, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { planGameLayout } from '../../core/path/layout.js';
import type { GameLayout } from '../../core/path/layout.js';
import type { InstallView } from '../../core/install/plan.js';
import type { PreparedInstallMetadata } from '../catalog/install-metadata.js';
import type { InstanceSummary } from '../storage/instance-records.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { FileViewError } from './file-views.js';
import type { NativeExtractor } from '../workers/native-extractor.js';
import type { NativeArchiveInput } from './native-archive.js';
import type { HashPool } from '../workers/hash-pool.js';
import { assetIndexAlias } from '../../core/install/plan.js';

export interface InstanceDirectories { layout: GameLayout; assets: string; libraries: string }
function dependencyId(metadata: PreparedInstallMetadata): string {
  const client = metadata.version.client.sha1.toLowerCase();
  const index = `indexes/${assetIndexAlias(metadata.version)}.json`;
  if (!metadata.plan.views.some(view => view.area === 'assets' && view.path === index)) return `dep-${client}`;
  const proof = metadata.metadataSha1ByVersion[metadata.version.jarVersionId];
  if (!proof || !/^[a-f0-9]{40}$/i.test(proof)) throw new FileViewError('NEEDS_RECOVERY');
  return `dep-${client}-${proof.toLowerCase()}`;
}
async function removeTemporaryFile(file: string): Promise<void> {
  try { await unlink(file); } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
}
async function removeNativeWorkspace(directory: string, temporary: string): Promise<void> {
  if (path.dirname(temporary) !== directory || !path.basename(temporary).startsWith('.oucl-natives-')) throw new FileViewError('NEEDS_RECOVERY');
  try { await guardDirectory(temporary); await rm(temporary, { recursive: true }); } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
}

/** Creates only explicitly planned ordinary directory components; unknown linked ancestors are refused. */
export async function ensureChildDirectory(parent: string, ...parts: string[]): Promise<string> {
  let current = await guardDirectory(parent);
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..') throw new FileViewError('INVALID_VIEW');
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
    current = await guardDirectory(current);
  }
  return current;
}
async function projection(gameRoot: string, name: 'assets' | 'libraries', view: string): Promise<string> {
  const target = path.join(gameRoot, name); let info;
  try { info = await lstat(target); } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
  if (info?.isSymbolicLink()) {
    if (path.resolve(gameRoot, await readlink(target)) !== view) throw new FileViewError('NEEDS_RECOVERY');
    return guardDirectory(view);
  }
  if (info) { if (!info.isDirectory()) throw new FileViewError('VIEW_CONFLICT'); return guardDirectory(target); }
  try { await symlink(view, target, process.platform === 'win32' ? 'junction' : 'dir'); return view; }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].some(code => hasCode(error, code))) throw error;
    return ensureChildDirectory(gameRoot, name);
  }
}

/** Computes the same controlled layout for installation and subsequent launch checks. */
export function instanceGameLayout(dataDirectory: string, summary: InstanceSummary, metadata: PreparedInstallMetadata): GameLayout {
  const inherited = metadata.version.jarVersionId !== metadata.version.id;
  const jarId = inherited ? dependencyId(metadata) : summary.instanceId;
  return planGameLayout({ dataDirectory, rootId: summary.rootId, instanceId: summary.instanceId,
    mcVersionId: summary.mcVersionId, directoryId: summary.instanceId, versionRecordId: summary.instanceId,
    jar: { directoryId: jarId, versionRecordId: jarId },
    isolation: { globalDefault: true, instance: summary.isolation, pack: false } });
}
/** Establishes the approved root views and private instance namespace without creating player-data placeholders. */
export async function prepareInstanceDirectories(dataDirectory: string, summary: InstanceSummary, metadata: PreparedInstallMetadata): Promise<InstanceDirectories> {
  const layout = instanceGameLayout(dataDirectory, summary, metadata);
  const inherited = metadata.version.jarVersionId !== metadata.version.id;
  const jarId = inherited ? dependencyId(metadata) : summary.instanceId;
  const store = await ensureChildDirectory(dataDirectory, 'store');
  const views = await ensureChildDirectory(store, 'views', summary.rootId);
  const roots = await ensureChildDirectory(dataDirectory, 'roots', summary.rootId, '.minecraft');
  await ensureChildDirectory(roots, 'versions', summary.instanceId);
  if (inherited) await ensureChildDirectory(roots, 'versions', jarId);
  const assets = await projection(roots, 'assets', await ensureChildDirectory(views, 'assets'));
  const libraries = await projection(roots, 'libraries', await ensureChildDirectory(views, 'libraries'));
  return { layout, assets, libraries };
}

/** Maps logical plan entries to the fixed views; upstream identifiers never become directory names. */
export function viewTarget(directories: InstanceDirectories, view: InstallView): { directory: string; relative: string } {
  if (view.area === 'assets' || view.area === 'libraries') return { directory: directories[view.area], relative: view.path };
  if (view.area === 'resources') return { directory: directories.layout.gameDirectory, relative: `resources/${view.path}` };
  if (view.path !== 'client.jar') throw new FileViewError('INVALID_VIEW');
  return { directory: path.dirname(directories.layout.jar), relative: path.basename(directories.layout.jar) };
}

/** Writes a derived JSON entry atomically, never replacing an unknown or conflicting existing file. */
export async function writeDerivedJson(file: string, data: unknown): Promise<void> {
  await guardDirectory(path.dirname(file)); const body = JSON.stringify(data) + '\n';
  const old = await readRegular(file);
  if (old !== undefined) { if (old.toString('utf8') !== body) throw new FileViewError('NEEDS_RECOVERY'); return; }
  const temporary = path.join(path.dirname(file), `.oucl-${randomUUID()}.tmp`); const handle = await open(temporary, 'wx');
  try {
    try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await removeTemporaryFile(temporary); }
}

/** Builds private natives in a fresh workspace; a prior matching published tree can be reused after interruption. */
export async function prepareInstanceNatives(directory: string, archives: NativeArchiveInput[], extractor: NativeExtractor,
  hasher: Pick<HashPool, 'hash'>, signal: AbortSignal): Promise<void> {
  await guardDirectory(directory); const temporary = await mkdtemp(path.join(directory, '.oucl-natives-')); const target = path.join(directory, 'natives');
  try {
    await extractor.run(temporary, archives, { signal });
    if (signal.aborted) throw new FileViewError('CANCELLED');
    let exists = false;
    try { await lstat(target); exists = true; } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
    if (!exists) { await rename(temporary, target); return; }
    const compare = async (left: string, right: string): Promise<void> => {
      await guardDirectory(left); await guardDirectory(right);
      const a = (await readdir(left)).sort(); const b = (await readdir(right)).sort();
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new FileViewError('NEEDS_RECOVERY');
      for (const name of a) {
        const first = path.join(left, name); const second = path.join(right, name); const info = await lstat(first); const other = await lstat(second);
        if (info.isSymbolicLink() || other.isSymbolicLink() || info.isDirectory() !== other.isDirectory()) throw new FileViewError('NEEDS_RECOVERY');
        if (info.isDirectory()) await compare(first, second);
        else {
          const options = { maximumBytes: 64 * 1024 * 1024, signal };
          if (!info.isFile() || !other.isFile() || (await hasher.hash(first, options)).sha256 !== (await hasher.hash(second, options)).sha256) throw new FileViewError('NEEDS_RECOVERY');
        }
      }
    };
    await compare(temporary, target);
  } finally {
    // temporary is this call's mkdtemp child; no player directory or linked target is recursively removed.
    await removeNativeWorkspace(directory, temporary);
  }
}
