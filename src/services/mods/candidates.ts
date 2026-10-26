import { inspectDependencyGraph } from '../../core/mods/dependency-graph.js';
import type { DependencyGraphResult } from '../../core/mods/dependency-graph.js';
import type { ModFormat } from '../../core/mods/declarations.js';
import type { PlatformModVersion } from '../../core/mods/platform.js';
import { resourceId } from '../../shared/contracts/resources.js';
import { ModPlatformError } from './modrinth.js';
import type { ModrinthModClient } from './modrinth.js';

export interface ModCandidateInput {
  roots: readonly string[]; selections: Readonly<Record<string, string>>; installed: readonly PlatformModVersion[];
  minecraft: string; loader: ModFormat; unknownInstalled: boolean;
}
export interface ModCandidateOption {
  projectId: string; requiredBy: string[]; truncated: boolean;
  versions: { versionId: string; name: string; versionNumber: string; release: PlatformModVersion['release']; publishedAt: string }[];
}
export interface ModCandidateClosure { graph: DependencyGraphResult; selected: PlatformModVersion[]; options: ModCandidateOption[] }
interface Pending { versionId: string; projectId: string | null; chain: string[] }

/** Collects pinned platform metadata only. Project-only choices stay explicit; no download or instance write is authorized. */
export class ModCandidateService {
  private active = false;
  constructor(private readonly client: Pick<ModrinthModClient, 'version' | 'candidates'>) {}

  async collect(input: ModCandidateInput, signal?: AbortSignal): Promise<ModCandidateClosure> {
    if (this.active) throw new ModPlatformError('PLATFORM_LIMIT');
    if (!input.roots.length || input.roots.length > 16 || input.roots.some(id => !resourceId(id))
      || input.installed.length > 256 || Object.keys(input.selections).length > 256
      || Object.entries(input.selections).some(([project, version]) => !resourceId(project) || !resourceId(version))
      || !/^[A-Za-z0-9_.+-]{1,160}$/.test(input.minecraft) || !['fabric', 'quilt', 'forge', 'neoforge'].includes(input.loader)) throw new ModPlatformError('INVALID_ARGUMENT');
    if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 ** 2) throw new ModPlatformError('PLATFORM_LIMIT');
    const snapshot = structuredClone(input);
    const check = (): void => { if (signal?.aborted) throw new ModPlatformError('CANCELLED'); };
    check(); this.active = true;
    try {
      const known = new Map<string, PlatformModVersion>(); const installed = new Map<string, PlatformModVersion>();
      for (const version of snapshot.installed) { known.set(version.versionId, version); installed.set(version.projectId, version); }
      const selected = new Map<string, PlatformModVersion>(); const expanded = new Set<string>();
      const options = new Map<string, ModCandidateOption>(); let metadataBytes = Buffer.byteLength(JSON.stringify(snapshot.installed)); let reads = 0;
      const pending: Pending[] = [...new Set(snapshot.roots)].sort().map(versionId => ({ versionId, projectId: null, chain: [] }));
      const read = async (item: Pending): Promise<PlatformModVersion> => {
        check(); let version = known.get(item.versionId);
        if (!version) {
          if (++reads > 512) throw new ModPlatformError('PLATFORM_LIMIT');
          version = structuredClone(await this.client.version(item.versionId, signal)); check();
          metadataBytes += Buffer.byteLength(JSON.stringify(version));
          if (metadataBytes > 8 * 1024 ** 2) throw new ModPlatformError('PLATFORM_LIMIT');
          known.set(item.versionId, version);
        }
        if (version.versionId !== item.versionId || item.projectId !== null && version.projectId !== item.projectId) throw new ModPlatformError('UNTRUSTED_METADATA');
        return version;
      };
      while (pending.length) {
        check(); const item = pending.pop()!; const version = await read(item);
        if (selected.size >= 256 && !selected.has(version.projectId)) throw new ModPlatformError('PLATFORM_LIMIT');
        const previous = selected.get(version.projectId);
        // Keep both identities so the graph reports the conflict; never silently replace an earlier pin.
        if (previous && previous.versionId !== version.versionId) {
          const graph = inspectDependencyGraph({ ...snapshot, selected: [...selected.values(), version] });
          return { graph, selected: [...selected.values(), version], options: [...options.values()] };
        }
        selected.set(version.projectId, version);
        options.delete(version.projectId);
        if (expanded.has(version.versionId) || item.chain.length >= 32) continue;
        expanded.add(version.versionId);
        if (installed.has(version.projectId) && installed.get(version.projectId)!.versionId !== version.versionId) continue;
        const chain = [...item.chain, version.projectId];
        for (const dependency of version.dependencies) {
          if (dependency.type !== 'required') continue;
          if (dependency.versionId) { pending.push({ versionId: dependency.versionId, projectId: dependency.projectId, chain }); continue; }
          if (!dependency.projectId) continue;
          const projectId = dependency.projectId;
          const fixed = installed.get(projectId)?.versionId ?? snapshot.selections[projectId] ?? selected.get(projectId)?.versionId;
          if (fixed) { pending.push({ versionId: fixed, projectId, chain }); continue; }
          const existing = options.get(projectId);
          if (existing) { if (!existing.requiredBy.includes(version.projectId)) existing.requiredBy.push(version.projectId); continue; }
          if (options.size >= 256 || ++reads > 512) throw new ModPlatformError('PLATFORM_LIMIT');
          const candidates = await this.client.candidates(projectId, snapshot.minecraft, snapshot.loader, signal); check();
          if (candidates.length > 512 || candidates.some(candidate => candidate.projectId !== projectId
            || !candidate.gameVersions.includes(snapshot.minecraft) || !candidate.loaders.includes(snapshot.loader))) throw new ModPlatformError('UNTRUSTED_METADATA');
          options.set(projectId, { projectId, requiredBy: [version.projectId], truncated: candidates.length > 32,
            versions: candidates.slice(0, 32).map(candidate => ({versionId: candidate.versionId, name: candidate.name, versionNumber: candidate.versionNumber,
              release: candidate.release, publishedAt: candidate.publishedAt})) });
          if (Buffer.byteLength(JSON.stringify([...options.values()])) > 2 * 1024 ** 2) throw new ModPlatformError('PLATFORM_LIMIT');
        }
      }
      check(); const versions = [...selected.values()];
      const graph = inspectDependencyGraph({ ...snapshot, selected: versions });
      return { graph, selected: versions, options: [...options.values()].sort((a, b) => a.projectId.localeCompare(b.projectId)) };
    } finally { this.active = false; }
  }
}

