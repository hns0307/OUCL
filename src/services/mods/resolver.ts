import type { PlatformModVersion } from '../../core/mods/platform.js';
import type { DependencyGraphIssue } from '../../core/mods/dependency-graph.js';
import { ModCandidateService, snapshotModCandidateInput } from './candidates.js';
import type { ModCandidateClosure, ModCandidateInput } from './candidates.js';
import { ModPlatformError } from './modrinth.js';
import type { ModrinthModClient } from './modrinth.js';

export interface ModResolution extends ModCandidateClosure { attempts: number }
const order = (left: PlatformModVersion, right: PlatformModVersion): number => Number(right.release === 'release') - Number(left.release === 'release')
  || Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || (left.versionId < right.versionId ? -1 : left.versionId > right.versionId ? 1 : 0);

/** Proposes a deterministic platform closure only. Downloaded JAR declarations and player confirmation remain mandatory. */
export class ModDependencyResolver {
  private active = false;
  constructor(private readonly client: Pick<ModrinthModClient, 'version' | 'candidates'>, private readonly maxStates = 1024) {
    if (!Number.isSafeInteger(maxStates) || maxStates < 1 || maxStates > 4096) throw new ModPlatformError('INVALID_ARGUMENT');
  }
  async resolve(input: ModCandidateInput, signal?: AbortSignal): Promise<ModResolution> {
    if (this.active) throw new ModPlatformError('PLATFORM_LIMIT');
    this.active = true;
    try {
      const snapshot = snapshotModCandidateInput(input); const versions = new Map<string, PlatformModVersion>();
      const projects = new Map<string, PlatformModVersion[]>(); let bytes = 0; let reads = 0; let attempts = 0;
      const began = Date.now(); let limited = false;
      const check = (): void => { if (signal?.aborted) throw new ModPlatformError('CANCELLED'); };
      const remember = (version: PlatformModVersion): PlatformModVersion => {
        const previous = versions.get(version.versionId);
        if (previous) {
          if (JSON.stringify({ ...previous, evidence: null }) !== JSON.stringify({ ...version, evidence: null })) throw new ModPlatformError('UNTRUSTED_METADATA');
          return previous;
        }
        bytes += Buffer.byteLength(JSON.stringify(version)); if (bytes > 8 * 1024 ** 2) throw new ModPlatformError('PLATFORM_LIMIT');
        const copy = structuredClone(version); versions.set(copy.versionId, copy); return copy;
      };
      const read = (): void => { check(); if (++reads > 512) throw new ModPlatformError('PLATFORM_LIMIT'); };
      const cached: Pick<ModrinthModClient, 'version' | 'candidates'> = {
        version: async (id, abort) => {
          check(); const known = versions.get(id); if (known) return known;
          read(); const version = await this.client.version(id, abort); check();
          if (version.versionId !== id) throw new ModPlatformError('UNTRUSTED_METADATA'); return remember(version);
        },
        candidates: async (project, minecraft, loader, abort) => {
          check(); const known = projects.get(project); if (known) return known;
          read(); const candidates = await this.client.candidates(project, minecraft, loader, abort); check();
          if (candidates.length > 512 || new Set(candidates.map(item => item.versionId)).size !== candidates.length
            || candidates.some(item => item.projectId !== project || !item.gameVersions.includes(minecraft) || !item.loaders.includes(loader))) throw new ModPlatformError('UNTRUSTED_METADATA');
          const result = candidates.map(remember).sort(order); projects.set(project, result); return result;
        }
      };
      const collector = new ModCandidateService(cached);
      let latest: ModCandidateClosure | undefined;
      const search = async (choices: Record<string, string>): Promise<ModCandidateClosure | undefined> => {
        check();
        if (attempts >= this.maxStates || Date.now() - began >= 30000) { limited = true; return undefined; }
        attempts++; // Yield between graph evaluations, keeping cancellation and application events responsive.
        await new Promise<void>(resolve => { setImmediate(resolve); }); check();
        const closure = await collector.collect({ ...snapshot, selections: { ...snapshot.selections, ...choices } }, signal);
        latest = closure;
        if (closure.graph.state === 'resolved' || closure.graph.state === 'conflict') return closure;
        const option = closure.options.find(item => !Object.hasOwn(snapshot.selections, item.projectId) && !Object.hasOwn(choices, item.projectId));
        if (!option) return closure;
        const candidates = projects.get(option.projectId) ?? [];
        let unknown: ModCandidateClosure | undefined; let conflict: ModCandidateClosure | undefined;
        // The UI's 32-entry preview is not the solver's candidate universe; all bounded metadata is considered.
        for (const candidate of candidates) {
          const result = await search({ ...choices, [option.projectId]: candidate.versionId });
          if (!result) return undefined;
          if (result.graph.state === 'resolved') return result;
          if (result.graph.state === 'unknown') unknown ??= result; else conflict ??= result;
        }
        if (unknown) return unknown;
        if (!conflict) return closure;
        const issue: DependencyGraphIssue = { severity: 'conflict', code: 'NO_SOLUTION', projectId: option.projectId, versionId: null, requiredBy: [...option.requiredBy] };
        return { ...conflict, graph: { ...conflict.graph, issues: [...conflict.graph.issues.slice(0, 511), issue] } };
      };
      const result = await search({}); check();
      if (limited) {
        if (!latest) throw new ModPlatformError('PLATFORM_LIMIT');
        const issue: DependencyGraphIssue = { severity: 'unknown', code: 'SEARCH_LIMIT', projectId: null, versionId: null, requiredBy: [] };
        return { ...latest, graph: { ...latest.graph, state: 'unknown', issues: [...latest.graph.issues.slice(0, 511), issue] }, attempts };
      }
      if (!result) throw new ModPlatformError('PLATFORM_LIMIT');
      return { ...result, attempts };
    } finally { this.active = false; }
  }
}
