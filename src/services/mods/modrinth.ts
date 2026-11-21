import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resourceFilename, resourceId } from '../../shared/contracts/resources.js';
import { isModrinthFileUrl } from '../resources/modrinth.js';
import type { ModFormat } from '../../core/mods/declarations.js';
import type { PlatformDependency, PlatformModFile, PlatformModVersion } from '../../core/mods/platform.js';
export type { PlatformDependency, PlatformModFile, PlatformModVersion } from '../../core/mods/platform.js';
export type ModPlatformCode = 'INVALID_ARGUMENT' | 'UNTRUSTED_METADATA' | 'NETWORK_FAILED' | 'NOT_FOUND' | 'RETRY_LATER' | 'CANCELLED' | 'PLATFORM_LIMIT';
export class ModPlatformError extends Error {
  readonly category: 'validation' | 'network' | 'cancelled' | 'biz';
  constructor(readonly code: ModPlatformCode) {
    super(code); this.name = 'ModPlatformError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'INVALID_ARGUMENT' || code === 'UNTRUSTED_METADATA' ? 'validation'
      : code === 'PLATFORM_LIMIT' ? 'biz' : 'network';
  }
}
function invalid(): never { throw new ModPlatformError('UNTRUSTED_METADATA'); }
function object(value: unknown): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function text(value: unknown, maximum: number): string { if (typeof value !== 'string' || !value.length || value.length > maximum || /[\p{C}]/u.test(value)) invalid(); return value; }
function identity(value: unknown): string { if (!resourceId(value)) invalid(); return value; }
function hash(value: unknown, length: number): string { if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) invalid(); return value; }
function strings(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || !value.length || value.length > maximum) invalid();
  const result = value.map(item => text(item, 160)); if (new Set(result).size !== result.length) invalid(); return result;
}
function parseVersion(value: unknown, evidence: PlatformModVersion['evidence']): PlatformModVersion {
  const row = object(value); const projectId = identity(row.project_id); const versionId = identity(row.id);
  const release = row.version_type; if (release !== 'release' && release !== 'beta' && release !== 'alpha') invalid();
  const publishedAt = text(row.date_published, 64); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) invalid();
  if (!Array.isArray(row.files) || !row.files.length || row.files.length > 64 || !Array.isArray(row.dependencies) || row.dependencies.length > 256) invalid();
  const files = row.files.map((value: unknown): PlatformModFile => {
    const file = object(value); const hashes = object(file.hashes);
    if (!resourceFilename(file.filename) || !isModrinthFileUrl(file.url) || !new URL(file.url).pathname.startsWith(`/data/${projectId}/`) || typeof file.size !== 'number'
      || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 ** 3 || typeof file.primary !== 'boolean') invalid();
    return { filename: file.filename, url: file.url, size: file.size, primary: file.primary, sha1: hash(hashes.sha1, 40), sha512: hash(hashes.sha512, 128) };
  });
  if (new Set(files.map(file => file.filename.toLowerCase())).size !== files.length || new Set(files.map(file => file.sha512)).size !== files.length) invalid();
  const dependencies = row.dependencies.map((value: unknown): PlatformDependency => {
    const dependency = object(value); const type = dependency.dependency_type;
    if (type !== 'required' && type !== 'optional' && type !== 'incompatible' && type !== 'embedded') invalid();
    if (dependency.file_name !== null && !resourceFilename(dependency.file_name)) invalid();
    return { type, projectId: dependency.project_id === null ? null : identity(dependency.project_id),
      versionId: dependency.version_id === null ? null : identity(dependency.version_id), filename: dependency.file_name as string | null };
  });
  return { projectId, versionId, release, publishedAt, name: text(row.name, 256), versionNumber: text(row.version_number, 160),
    loaders: strings(row.loaders, 32), gameVersions: strings(row.game_versions, 2048), environment: row.environment === undefined ? 'unknown' : text(row.environment, 64),
    dependencies, files, evidence };
}

/** Official bounded metadata only; no search result ever authorizes a modId→project association. */
export class ModrinthModClient {
  private active = 0;
  private cooldown = 0;
  constructor(private readonly request: typeof fetch = fetch) {}

  private async read(endpoint: string, signal?: AbortSignal, hashes?: readonly string[]): Promise<{ value: unknown; evidence: PlatformModVersion['evidence'] }> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.readOnce(endpoint, signal, hashes); }
      catch (error) {
        if (!(error instanceof ModPlatformError) || error.code !== 'NETWORK_FAILED' || attempt >= 1) throw error;
        try { await delay(250, undefined, { signal }); } catch { throw new ModPlatformError('CANCELLED'); }
      }
    }
  }

  private async readOnce(endpoint: string, signal?: AbortSignal, hashes?: readonly string[]): Promise<{ value: unknown; evidence: PlatformModVersion['evidence'] }> {
    if (this.active >= 4) throw new ModPlatformError('PLATFORM_LIMIT');
    if (Date.now() < this.cooldown) throw new ModPlatformError('RETRY_LATER');
    if (signal?.aborted) throw new ModPlatformError('CANCELLED');
    const url = `https://api.modrinth.com/v2/${endpoint}`;
    const controller = new AbortController(); const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 12000); this.active++;
    try {
      const response = await this.request(url, { method: hashes ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { 'User-Agent': 'hns0307/OUCL (https://github.com/hns0307/OUCL)', Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(hashes ? { body: JSON.stringify({ hashes, algorithm: 'sha512' }) } : {}) });
      if (response.status === 429) { const seconds = Number(response.headers.get('retry-after') ?? '60'); this.cooldown = Date.now() + Math.max(1, Math.min(300, Number.isFinite(seconds) ? seconds : 60)) * 1000; throw new ModPlatformError('RETRY_LATER'); }
      if (response.status === 404) throw new ModPlatformError('NOT_FOUND');
      if (response.status !== 200 || !response.body) throw new ModPlatformError('NETWORK_FAILED');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8 * 1024 ** 2)) throw new ModPlatformError('PLATFORM_LIMIT');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for await (const chunk of response.body) { size += chunk.byteLength; if (size > 8 * 1024 ** 2) throw new ModPlatformError('PLATFORM_LIMIT'); chunks.push(chunk); }
      } finally { await response.body.cancel().catch(() => {}); }
      const bytes = Buffer.concat(chunks); let value: unknown;
      if (signal?.aborted) throw new ModPlatformError('CANCELLED');
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { invalid(); }
      return { value, evidence: { url, sha256: createHash('sha256').update(bytes).digest('hex') } };
    } catch (error) {
      if (error instanceof ModPlatformError) throw error;
      throw new ModPlatformError(signal?.aborted ? 'CANCELLED' : 'NETWORK_FAILED');
    } finally { clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort); this.active--; }
  }

  /** Associates a specific file by SHA-512, preserving absent matches as absent rather than searching by name. */
  async byHashes(hashes: readonly string[], signal?: AbortSignal): Promise<Map<string, PlatformModVersion>> {
    if (!hashes.length || hashes.length > 64 || new Set(hashes).size !== hashes.length || hashes.some(value => !/^[a-f0-9]{128}$/.test(value))) throw new ModPlatformError('INVALID_ARGUMENT');
    const reply = await this.read('version_files', signal, hashes); const values = object(reply.value);
    if (Object.keys(values).length > hashes.length) invalid(); const results = new Map<string, PlatformModVersion>();
    for (const [key, raw] of Object.entries(values)) {
      if (!hashes.includes(key)) invalid(); const version = parseVersion(raw, reply.evidence);
      if (!version.files.some(file => file.sha512 === key)) invalid(); results.set(key, version);
    }
    return results;
  }
  /** A pinned dependency is fetched by exact version ID; callers must verify its project and downloaded declaration. */
  async version(versionId: string, signal?: AbortSignal): Promise<PlatformModVersion> {
    if (!resourceId(versionId)) throw new ModPlatformError('INVALID_ARGUMENT');
    const reply = await this.read(`version/${versionId}`, signal); const version = parseVersion(reply.value, reply.evidence);
    if (version.versionId !== versionId) invalid(); return version;
  }
  /** Orders candidates by stable release first, publication descending, then version ID ascending. Never upgrades an installed file. */
  async candidates(projectId: string, minecraft: string, loader: ModFormat, signal?: AbortSignal): Promise<PlatformModVersion[]> {
    if (!resourceId(projectId) || !/^[A-Za-z0-9_.+-]{1,160}$/.test(minecraft) || !['fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) throw new ModPlatformError('INVALID_ARGUMENT');
    const query = new URLSearchParams({ game_versions: JSON.stringify([minecraft]), loaders: JSON.stringify([loader]) });
    const reply = await this.read(`project/${projectId}/version?${query}`, signal);
    if (!Array.isArray(reply.value) || reply.value.length > 512) throw new ModPlatformError('PLATFORM_LIMIT');
    const versions = reply.value.map(raw => parseVersion(raw, reply.evidence));
    if (versions.some(version => version.projectId !== projectId || !version.gameVersions.includes(minecraft) || !version.loaders.includes(loader))
      || new Set(versions.map(version => version.versionId)).size !== versions.length) invalid();
    return versions.sort((left, right) => Number(right.release === 'release') - Number(left.release === 'release')
      || Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || (left.versionId < right.versionId ? -1 : left.versionId > right.versionId ? 1 : 0));
  }
}
