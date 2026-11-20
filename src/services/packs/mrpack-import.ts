import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { installRelativePath } from '../../core/install/assets.js';
import { identifier } from '../../core/version/validation.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import type { LoaderKind } from '../../shared/contracts/loaders.js';
import type { PlatformModFile, PlatformModVersion } from '../../core/mods/platform.js';
import type { DownloadSpec } from '../download/types.js';
import { ensureChildDirectory } from '../install/instance-files.js';
import { readVerifiedArchiveEntries } from '../install/native-archive.js';
import { ModrinthModClient } from '../mods/modrinth.js';
import type { ObjectRef } from '../objects/store.js';
import { isModrinthFileUrl } from '../resources/modrinth.js';
import { guardDirectory, hasCode } from '../storage/files.js';

const MIB = 1024 * 1024;
const INDEX = 'modrinth.index.json';
const LOADERS: Readonly<Record<string, LoaderKind>> = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };
const ENVIRONMENT = new Set(['required', 'optional', 'unsupported']);
const sha1 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sha512 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{128}$/.test(value);

type MrpackCode = 'UNSUPPORTED_IMPORT' | 'UNTRUSTED_METADATA' | 'HASH_MISMATCH' | 'CANCELLED' | 'NEEDS_RECOVERY';
export class MrpackImportError extends Error {
  constructor(readonly code: MrpackCode) { super(code); this.name = 'MrpackImportError'; }
}
interface PackSource { file: string; proof: { size: number; sha256: string } }
interface PackServices {
  dataDirectory: string;
  transferResource(spec: DownloadSpec, consumerId: string, options: { signal: AbortSignal }): Promise<ObjectRef>;
  transport?: typeof fetch;
}
interface FileRequest { path: string; size: number; sha1: string; sha512: string }
interface PlannedFile extends FileRequest { spec: DownloadSpec; object: ObjectRef }
interface Override { path: string; body: Buffer }
interface UnpackedPack {
  mcVersionId: string;
  loader?: { kind: LoaderKind; version: string };
  required: FileRequest[];
  overrides: Override[];
}
export interface PreparedMrpackImport {
  sha256: string;
  mcVersionId: string;
  loader?: { kind: LoaderKind; version: string };
  stage(signal: AbortSignal): Promise<void>;
  publish(gameDirectory: string, signal: AbortSignal): Promise<void>;
}
function unsupported(): never { throw new MrpackImportError('UNSUPPORTED_IMPORT'); }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) unsupported();
  return value as Record<string, unknown>;
}
function cancel(signal: AbortSignal): void { if (signal.aborted) throw new MrpackImportError('CANCELLED'); }
function relative(value: string): string { try { return installRelativePath(value); } catch { return unsupported(); } }
function identity(value: unknown): value is string {
  return identifier(value) && /^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,159}$/.test(value);
}
function downloadHint(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('https://') || value.length > 2048 || /[\s\\\p{C}]/u.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
function allowedFile(value: string): boolean {
  return /^mods\/[^/]+\.jar$/i.test(value) || /^(?:resourcepacks|shaderpacks)\/[^/]+\.zip$/i.test(value);
}
function requiredFile(input: unknown): FileRequest | undefined {
  const file = record(input);
  const env = file.env === undefined ? undefined : record(file.env);
  if (env && (!ENVIRONMENT.has(String(env.client)) || !ENVIRONMENT.has(String(env.server)))) unsupported();
  if (env && env.client !== 'required') return;
  if (typeof file.path !== 'string' || !allowedFile(relative(file.path)) || !Array.isArray(file.downloads)
    || file.downloads.length < 1 || file.downloads.length > 8 || !file.downloads.every(downloadHint)
    || typeof file.fileSize !== 'number' || !Number.isSafeInteger(file.fileSize) || file.fileSize < 1 || file.fileSize > 64 * MIB) unsupported();
  const hashes = record(file.hashes);
  if (!sha1(hashes.sha1) || !sha512(hashes.sha512)) unsupported();
  return { path: file.path, size: file.fileSize, sha1: hashes.sha1, sha512: hashes.sha512 };
}

function overrideTarget(name: string): string | undefined {
  const match = /^(?:client-)?overrides\/(.+)$/.exec(name);
  if (!match) return;
  const target = relative(match[1]!);
  if (target === 'options.txt') return target;
  if (!/^(?:config|defaultconfigs)\/(?:[a-zA-Z0-9_.-]+\/)*[^/]+\.(?:json|toml|properties|cfg)$/.test(target)) unsupported();
  return target;
}
async function unpack(source: PackSource): Promise<UnpackedPack> {
  const archive = { file: source.file, size: source.proof.size, sha256: source.proof.sha256 };
  const entries = await readVerifiedArchiveEntries(archive, (name, length) => {
    if (name === INDEX) { if (length > MIB) unsupported(); return true; }
    if (!overrideTarget(name)) return false;
    if (length > 256 * 1024) unsupported();
    return true;
  }, 8 * MIB);
  const index = entries.find(entry => entry.name === INDEX);
  if (!index) return unsupported();
  const decode = new TextDecoder('utf-8', { fatal: true });
  const manifest = record(JSON.parse(decode.decode(index.body)));
  if (manifest.formatVersion !== 1 || manifest.game !== 'minecraft' || !Array.isArray(manifest.files) || manifest.files.length > 512
    || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 160
    || typeof manifest.versionId !== 'string' || !manifest.versionId.trim() || manifest.versionId.length > 160) unsupported();
  const dependencies = record(manifest.dependencies);
  const minecraft = dependencies.minecraft;
  const other = Object.entries(dependencies).filter(([name]) => name !== 'minecraft');
  if (!identity(minecraft) || other.length > 1) return unsupported();
  let loader: UnpackedPack['loader'];
  if (other.length) {
    const [id, version] = other[0]!;
    const kind = Object.hasOwn(LOADERS, id) ? LOADERS[id] : undefined;
    if (!kind || !identity(version)) unsupported();
    loader = { kind, version };
  }
  const required = manifest.files.map(requiredFile).filter((file): file is FileRequest => file !== undefined);
  if (required.length > 256 || required.reduce((total, file) => total + file.size, 0) > 2 * 1024 * MIB
    || new Set(required.map(file => file.path.toLowerCase())).size !== required.length
    || (!loader && required.some(file => file.path.toLowerCase().startsWith('mods/')))) unsupported();
  const overrides = new Map<string, Override>();
  // The client layer wins only for the exact same logical destination.
  const sorted = entries.filter(entry => entry.name !== INDEX).sort((left, right) =>
    Number(left.name.startsWith('client-overrides/')) - Number(right.name.startsWith('client-overrides/')));
  for (const entry of sorted) {
    const target = overrideTarget(entry.name)!;
    const text = decode.decode(entry.body);
    if (/\p{Cc}/u.test(text.replace(/[\r\n\t]/g, ''))) unsupported();
    const key = target.toLowerCase();
    const previous = overrides.get(key);
    if (previous && previous.path !== target) unsupported();
    overrides.set(key, { path: target, body: entry.body });
  }
  return { mcVersionId: minecraft, ...(loader ? { loader } : {}), required, overrides: [...overrides.values()] };
}
function proofFor(pack: UnpackedPack, required: FileRequest, version: PlatformModVersion | undefined): { version: PlatformModVersion; file: PlatformModFile } {
  const filename = required.path.split('/').at(-1)!;
  const match = version?.files.find(file => file.sha512 === required.sha512 && file.sha1 === required.sha1 && file.size === required.size);
  if (!version || !match || !isModrinthFileUrl(match.url) || match.filename !== filename
    || version.evidence.url !== 'https://api.modrinth.com/v2/version_files' || !/^[a-f0-9]{64}$/.test(version.evidence.sha256)
    || !version.gameVersions.includes(pack.mcVersionId)
    || (required.path.toLowerCase().startsWith('mods/') && (!pack.loader || !version.loaders.includes(pack.loader.kind)
      || ['server_only', 'dedicated_server_only'].includes(version.environment)))) throw new MrpackImportError('UNTRUSTED_METADATA');
  return { version, file: match };
}
async function downloadPack(pack: UnpackedPack, services: PackServices, caller: AbortSignal): Promise<PlannedFile[]> {
  const client = new ModrinthModClient(services.transport);
  const hashes = [...new Set(pack.required.map(file => file.sha512))];
  const versions = new Map<string, PlatformModVersion>();
  for (let offset = 0; offset < hashes.length; offset += 64) {
    cancel(caller);
    for (const [hash, version] of await client.byHashes(hashes.slice(offset, offset + 64), caller)) versions.set(hash, version);
  }
  const work = pack.required.map(required => {
    const { version, file } = proofFor(pack, required, versions.get(required.sha512));
    const spec: DownloadSpec = { url: file.url, expected: { algorithm: 'sha1', digest: file.sha1, size: file.size,
      provenanceId: ['modrinth', version.projectId, version.versionId, file.sha1].join(':') },
    anchor: { kind: 'modrinth-version', algorithm: 'sha256', digest: version.evidence.sha256 } };
    return { ...required, spec };
  });
  const output: PlannedFile[] = [];
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, caller]);
  let next = 0;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(3, work.length) }, async () => {
    try {
      while (next < work.length) {
        cancel(signal);
        const file = work[next++]!;
        const object = await services.transferResource(file.spec, randomUUID(), { signal });
        if (object.size !== file.size || !/^[a-f0-9]{64}$/.test(object.digest)) throw new MrpackImportError('HASH_MISMATCH');
        output.push({ ...file, object });
      }
    } catch (error) {
      failure ??= error;
      abort.abort();
    }
  }));
  if (failure !== undefined) throw failure;
  cancel(caller);
  return output;
}

async function copyVerified(dataRoot: string, file: PlannedFile, staged: string, signal: AbortSignal): Promise<void> {
  const source = path.join(dataRoot, 'store', 'objects', 'sha256', file.object.digest.slice(0, 2), file.object.digest);
  await guardDirectory(path.dirname(source));
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== file.size) throw new MrpackImportError('HASH_MISMATCH');
  const input = await open(source, 'r');
  try {
    const opened = await input.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== file.size) throw new MrpackImportError('HASH_MISMATCH');
    const output = await open(staged, 'wx', 0o600);
    try {
      const digests = [createHash('sha1'), createHash('sha512'), createHash('sha256')];
      const block = Buffer.alloc(MIB);
      let size = 0;
      while (true) {
        cancel(signal);
        const { bytesRead } = await input.read(block, 0, block.length);
        if (bytesRead === 0) break;
        const bytes = block.subarray(0, bytesRead);
        size += bytes.length;
        if (size > file.size) throw new MrpackImportError('HASH_MISMATCH');
        for (const digest of digests) digest.update(bytes);
        let written = 0;
        while (written < bytes.length) {
          const result = await output.write(bytes, written, bytes.length - written);
          if (!result.bytesWritten) throw new MrpackImportError('NEEDS_RECOVERY');
          written += result.bytesWritten;
        }
      }
      const [observedSha1, observedSha512, observedSha256] = digests.map(digest => digest.digest('hex'));
      if (size !== file.size || observedSha1 !== file.sha1 || observedSha512 !== file.sha512 || observedSha256 !== file.object.digest)
        throw new MrpackImportError('HASH_MISMATCH');
      await output.sync();
    } finally { await output.close(); }
  } finally { await input.close(); }
}
function instanceRoot(data: string, game: string): boolean {
  const [roots, rootId, minecraft, versions, instanceId, ...extra] = path.relative(data, game).split(path.sep);
  return roots === 'roots' && !!rootId && UUID_PATTERN.test(rootId) && minecraft === '.minecraft'
    && versions === 'versions' && !!instanceId && UUID_PATTERN.test(instanceId) && extra.length === 0;
}
interface StagedFile { name: string; temporary: string; target?: string }

async function publishPack(pack: UnpackedPack, files: PlannedFile[], services: PackServices, gameDirectory: string, signal: AbortSignal): Promise<void> {
  cancel(signal);
  const data = await guardDirectory(services.dataDirectory); const game = await guardDirectory(gameDirectory);
  if (!instanceRoot(data, game)) throw new MrpackImportError('NEEDS_RECOVERY');
  const workspace = path.join(game, '.oucl-pack-' + randomUUID());
  await mkdir(workspace);
  const staged: StagedFile[] = [];
  try {
    async function stage(name: string, write: (temporary: string) => Promise<void>): Promise<void> {
      cancel(signal);
      if (await guardDirectory(workspace) !== workspace || path.dirname(workspace) !== game) throw new MrpackImportError('NEEDS_RECOVERY');
      const temporary = path.join(workspace, String(staged.length));
      staged.push({ name, temporary });
      await write(temporary);
    }
    for (const file of files) await stage(file.path, temporary => copyVerified(data, file, temporary, signal));
    for (const override of pack.overrides) await stage(override.path, async temporary => {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(override.body); await handle.sync(); } finally { await handle.close(); }
    });
    for (const entry of staged) {
      cancel(signal);
      const components = entry.name.split('/'); const name = components.pop()!;
      const parent = components.length ? await ensureChildDirectory(game, ...components) : await guardDirectory(game);
      if (await guardDirectory(workspace) !== workspace) throw new MrpackImportError('NEEDS_RECOVERY');
      const source = await lstat(entry.temporary);
      if (!source.isFile() || source.isSymbolicLink() || source.nlink !== 1) throw new MrpackImportError('NEEDS_RECOVERY');
      const target = path.join(parent, name);
      await link(entry.temporary, target); // No replacement of any existing player-controlled entry.
      entry.target = target;
    }
    cancel(signal);
  } catch (error) {
    for (const entry of staged) if (entry.target) {
      await guardDirectory(path.dirname(entry.target));
      const [source, target] = await Promise.all([lstat(entry.temporary), lstat(entry.target)]);
      if (!target.isFile() || target.isSymbolicLink() || source.dev !== target.dev || source.ino !== target.ino)
        throw new MrpackImportError('NEEDS_RECOVERY');
      await unlink(entry.target);
    }
    throw error;
  } finally { await cleanWorkspace(workspace, game, staged); }
}

async function cleanWorkspace(workspace: string, game: string, staged: StagedFile[]): Promise<void> {
  if (await guardDirectory(workspace) !== workspace || path.dirname(workspace) !== game) throw new MrpackImportError('NEEDS_RECOVERY');
  for (const entry of staged) await unlink(entry.temporary).catch(error => { if (!hasCode(error, 'ENOENT')) throw error; });
  await rmdir(workspace);
}

/** Prepares an isolated client pack. The manifest controls placement; official Modrinth bytes control downloads. */
export async function prepareMrpackImport(source: PackSource, services: PackServices): Promise<PreparedMrpackImport> {
  let pack: UnpackedPack;
  try { pack = await unpack(source); } catch (error) {
    if (error instanceof MrpackImportError) throw error;
    throw new MrpackImportError('UNSUPPORTED_IMPORT');
  }
  let files: PlannedFile[] | undefined;
  let staging: Promise<void> | undefined;
  const stage = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(new MrpackImportError('CANCELLED'));
    if (files) return Promise.resolve();
    staging ??= downloadPack(pack, services, signal).then(result => { files = result; }).finally(() => { staging = undefined; });
    return staging;
  };
  return {
    sha256: source.proof.sha256, mcVersionId: pack.mcVersionId, ...(pack.loader ? { loader: pack.loader } : {}), stage,
    publish: async (gameDirectory, signal) => {
      await stage(signal);
      if (!files) throw new MrpackImportError('NEEDS_RECOVERY');
      await publishPack(pack, files, services, gameDirectory, signal);
    },
  };
}
