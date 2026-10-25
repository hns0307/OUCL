import { createHash } from 'node:crypto';
import { ResourceContractError, isResourceData, isResourceVersion, resourceFilename, resourceId, resourceKind } from '../../shared/contracts/resources.js';
import type { ResourceData, ResourcePayloads, ResourceQuery, ResourceVersion, ResourceKind } from '../../shared/contracts/resources.js';
import type { DownloadSpec } from '../download/types.js';

const AGENT = 'hns0307/OUCL/0.2.1 (https://github.com/hns0307/OUCL)';
const LIMIT = 8 * 1024 * 1024;
function object(x: unknown): Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new ResourceContractError('NETWORK_FAILED'); return x as Record<string, unknown>;
}
function label(x: unknown, max: number): string { if (typeof x !== 'string') throw new ResourceContractError('NETWORK_FAILED'); return x.replace(/[\p{C}]/gu, ' ').slice(0, max); }
export function isModrinthFileUrl(x: unknown): x is string {
  if (typeof x !== 'string' || x.length > 2048) return false;
  try { const u = new URL(x); return u.protocol === 'https:' && u.hostname === 'cdn.modrinth.com' && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/data\/[a-zA-Z0-9]{8}\/(?:versions\/)?/.test(u.pathname); } catch { return false; }
}
export interface SelectedResource { title: string; kind: ResourceKind; version: ResourceVersion; filename: string; spec: DownloadSpec }
/** Bounded first-party API reader. The injected transport supports network-free tests. */
export class ModrinthClient {
  private active = 0;
  private cooldown = 0;
  constructor(private readonly transport: typeof fetch = fetch) {}
  private async get(endpoint: string, params = new URLSearchParams()): Promise<{ value: unknown; digest: string }> {
    if (this.active >= 4) throw new ResourceContractError('UNAVAILABLE');
    if (Date.now() < this.cooldown) throw new ResourceContractError('RETRY_LATER');
    const url = new URL(`https://api.modrinth.com/v2/${endpoint}`); url.search = params.toString();
    this.active++;
    const controller = new AbortController(); const timer = setTimeout(() => { controller.abort(); }, 12000);
    try {
      const response = await this.transport(url, { redirect: 'error', signal: controller.signal, headers: { 'User-Agent': AGENT, Accept: 'application/json' } });
      if (response.status === 429) { const seconds = Number(response.headers.get('retry-after') ?? '60'); this.cooldown = Date.now() + Math.min(300, Math.max(1, Number.isFinite(seconds) ? seconds : 60)) * 1000; throw new ResourceContractError('RETRY_LATER'); }
      if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > LIMIT) throw new ResourceContractError('NETWORK_FAILED');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > LIMIT) throw new ResourceContractError('NETWORK_FAILED'); chunks.push(part.value); } }
      finally { await reader.cancel().catch(() => {}); }
      const bytes = Buffer.concat(chunks); return { value: JSON.parse(bytes.toString('utf8')) as unknown, digest: createHash('sha256').update(bytes).digest('hex') };
    } catch (error) { if (error instanceof ResourceContractError) throw error; throw new ResourceContractError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_FAILED'); }
    finally { clearTimeout(timer); this.active--; }
  }
  /** Searches the selected project type, preserving server pagination and version/loader facets. */
  async search(query: ResourceQuery): Promise<ResourceData['resources:search']> {
    const facets = [[`project_type:${query.kind}`], ...(query.gameVersion ? [[`versions:${query.gameVersion}`]] : []), ...(query.loader ? [[`categories:${query.loader}`]] : [])];
    const { value } = await this.get('search', new URLSearchParams({ query: query.query, facets: JSON.stringify(facets), offset: String(query.offset), limit: '20', index: query.query ? 'relevance' : 'downloads' }));
    const row = object(value);
    if (!Array.isArray(row.hits)) throw new ResourceContractError('NETWORK_FAILED');
    const data = { items: row.hits.map((hit: unknown) => { const h = object(hit); return { projectId: h.project_id, title: label(h.title, 200), author: label(h.author, 200), description: label(h.description, 1000), downloads: h.downloads, kind: h.project_type }; }), total: row.total_hits, offset: row.offset };
    if (!isResourceData(data, 'resources:search') || data.items.some(item => item.kind !== query.kind)) throw new ResourceContractError('NETWORK_FAILED'); return data;
  }
  private version(value: unknown, projectId: string): ResourceVersion {
    const row = object(value);
    if (row.project_id !== projectId || !Array.isArray(row.files)) throw new ResourceContractError('NETWORK_FAILED');
    const data = { versionId: row.id, name: label(row.name, 200), gameVersions: row.game_versions, loaders: row.loaders, files: row.files.filter((f: unknown) => { const file = object(f); return resourceFilename(file.filename); }).map((f: unknown) => {
      const file = object(f); const hashes = object(file.hashes); return { fileId: hashes.sha1, filename: file.filename, size: file.size, primary: file.primary };
    }) };
    if (!isResourceVersion(data)) throw new ResourceContractError('NETWORK_FAILED'); return data;
  }
  /** Projects safe file identifiers; only the main service can resolve them into download URLs. */
  async versions(input: ResourcePayloads['resources:versions']): Promise<ResourceData['resources:versions']> {
    const params = new URLSearchParams(); if (input.gameVersion) params.set('game_versions', JSON.stringify([input.gameVersion])); if (input.loader) params.set('loaders', JSON.stringify([input.loader]));
    const { value } = await this.get(`project/${input.projectId}/version`, params);
    if (!Array.isArray(value)) throw new ResourceContractError('NETWORK_FAILED');
    return { items: value.slice(0, 100).map(v => this.version(v, input.projectId)).filter(v => v.files.length > 0) };
  }
  /** Re-fetches authoritative project/version metadata; renderer-provided hashes are selectors, never trust anchors. */
  async select(input: ResourcePayloads['resources:download']): Promise<SelectedResource> {
    if (!resourceId(input.projectId) || !resourceId(input.versionId)) throw new ResourceContractError('INVALID_ARGUMENT');
    const [projectReply, reply] = await Promise.all([this.get(`project/${input.projectId}`), this.get(`version/${input.versionId}`)]);
    const project = object(projectReply.value); if (project.id !== input.projectId || !resourceKind(project.project_type)) throw new ResourceContractError('INVALID_ARGUMENT');
    const version = this.version(reply.value, input.projectId); const file = version.files.find(f => f.fileId === input.fileId);
    const raw = object(reply.value); const upstream = (raw.files as unknown[]).map(object).find(f => object(f.hashes).sha1 === input.fileId);
    if (!file || !upstream || !isModrinthFileUrl(upstream.url)) throw new ResourceContractError('INVALID_ARGUMENT');
    return { title: label(project.title, 200), kind: project.project_type, version, filename: file.filename, spec: { url: upstream.url,
      expected: { algorithm: 'sha1', digest: file.fileId, size: file.size, provenanceId: `modrinth:${input.projectId}:${input.versionId}:${input.fileId}` },
      anchor: { kind: 'modrinth-version', algorithm: 'sha256', digest: reply.digest } } };
  }
}
