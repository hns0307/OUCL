import { createHash } from 'node:crypto';
import type { ModFormat } from '../../core/mods/declarations.js';
import type { DependencyGraphIssue } from '../../core/mods/dependency-graph.js';
import type { PlatformModVersion } from '../../core/mods/platform.js';
import type { ResourcePayloads } from '../../shared/contracts/resources.js';
import { ModContractError } from '../../shared/contracts/mods.js';
import type { ModInventoryContext } from './inventory.js';
import type { ModInspectionService } from './inspection.js';
import type { ModLibraryReader } from './library.js';
import type { ModDependencyResolver } from './resolver.js';

export interface ModPlanInput {
  instanceId: string; expectedRevision: number; root: ResourcePayloads['resources:download'];
  selections: Readonly<Record<string, string>>;
}
export interface ModPlanItem {
  projectId: string; versionId: string; filename: string; fileId: string; sha512: string; size: number;
  disposition: 'reuse' | 'library' | 'download'; requiredBy: string[];
}
export interface ModInstallPlan {
  formatVersion: 1; planId: string; instanceId: string; instanceRevision: number; fingerprint: string;
  minecraft: string; loader: ModFormat; rootVersionId: string; state: 'ready' | 'conflict' | 'unknown';
  attempts: number; totalDownloadBytes: number; items: ModPlanItem[]; issues: DependencyGraphIssue[];
}

function selectedFile(version: PlatformModVersion, sha512: string | null) {
  if (!sha512) return undefined;
  const matches = version.files.filter(file => file.sha512 === sha512);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Builds a path-free, non-authorizing preview. Confirmation must re-read every input and downloaded JAR. */
export class ModInstallPlanner {
  private active = false;
  constructor(private readonly library: Pick<ModLibraryReader, 'read'>,
    private readonly inspections: Pick<ModInspectionService, 'check'>,
    private readonly context: (instanceId: string, signal?: AbortSignal) => Promise<ModInventoryContext>,
    private readonly resolver: Pick<ModDependencyResolver, 'resolve'>) {}

  async plan(input: ModPlanInput, signal?: AbortSignal): Promise<ModInstallPlan> {
    if (this.active) throw new ModContractError('SCAN_BUSY');
    this.active = true;
    const check = (): void => { if (signal?.aborted) throw new ModContractError('CANCELLED'); };
    try {
      check(); const root = await this.library.read(input.root, signal); check();
      const inspection = await this.inspections.check(input.instanceId, input.expectedRevision, signal); check();
      const context = await this.context(input.instanceId.toLowerCase(), signal); check();
      if (context.instanceId !== inspection.inventory.instanceId || context.revision !== inspection.inventory.revision
        || context.revision !== input.expectedRevision) throw new ModContractError('REVISION_CONFLICT');
      if (context.environment.loader === 'vanilla') throw new ModContractError('INVALID_ARGUMENT');
      const loader = context.environment.loader; const minecraft = context.environment.versions.minecraft;
      if (!minecraft) throw new ModContractError('INVALID_ARGUMENT');
      const declarations = root.scan.archives.find(archive => archive.entries.length === 0)?.declarations ?? [];
      const acceptsLoader = declarations.some(item => item.format === loader || loader === 'quilt' && item.format === 'fabric');
      if (!acceptsLoader || declarations.some(item => item.issues.length > 0)) throw new ModContractError('MODS_UNSAFE');

      if (inspection.inventory.local.issues.some(issue => issue.severity === 'error' && issue.code !== 'MOD_DEPENDENCY_MISSING')) throw new ModContractError('MODS_UNSAFE');
      const enabled = new Set(inspection.inventory.items.filter(item => item.enabled).map(item => item.fileId));
      const installed: PlatformModVersion[] = []; let unknownInstalled = inspection.platformFailures.length > 0
        || inspection.inventory.local.issues.some(issue => issue.severity === 'unknown');
      const projects = new Map<string, string>();
      for (const association of inspection.platform.files) {
        if (!enabled.has(association.fileId)) continue;
        if (association.status !== 'matched' || !association.version) { unknownInstalled = true; continue; }
        const previous = projects.get(association.version.projectId);
        if (previous && previous !== association.version.versionId) unknownInstalled = true;
        else if (!previous) { projects.set(association.version.projectId, association.version.versionId); installed.push(association.version); }
      }
      if (inspection.inventory.items.some(item => item.enabled && item.archives.some(archive => archive.entries.length > 0 || archive.jarJar))) unknownInstalled = true;
      const resolution = await this.resolver.resolve({ roots: [root.version.versionId], selections: input.selections, installed,
        minecraft, loader, unknownInstalled }, signal); check();
      const resolvedRoot = resolution.selected.find(item => item.versionId === root.version.versionId);
      if (!resolvedRoot || JSON.stringify(resolvedRoot) !== JSON.stringify(root.version)) throw new ModContractError('UNTRUSTED_METADATA');
      const versions = new Map([...installed, ...resolution.selected].map(version => [version.versionId, version]));
      const items: ModPlanItem[] = resolution.graph.nodes.flatMap(node => {
        const version = versions.get(node.versionId); if (!version) throw new ModContractError('UNTRUSTED_METADATA');
        const file = selectedFile(version, node.sha512); if (!file) return [];
        const disposition = node.disposition === 'reuse' ? 'reuse' : node.versionId === root.version.versionId ? 'library' : 'download';
        if (disposition === 'library' && (file.filename !== root.record.filename || file.sha1 !== root.scan.sha1
          || file.sha512 !== root.scan.sha512 || file.size !== root.scan.size)) throw new ModContractError('UNTRUSTED_METADATA');
        return [{ projectId: node.projectId, versionId: node.versionId, filename: file.filename, fileId: file.sha1,
          sha512: file.sha512, size: file.size, disposition, requiredBy: [...node.requiredBy] }];
      });
      const state: ModInstallPlan['state'] = resolution.graph.state === 'resolved' ? 'ready' : resolution.graph.state;
      const body = { formatVersion: 1 as const, instanceId: context.instanceId, instanceRevision: context.revision,
        fingerprint: inspection.inventory.fingerprint, minecraft, loader, rootVersionId: root.version.versionId, state,
        attempts: resolution.attempts, totalDownloadBytes: items.filter(item => item.disposition === 'download').reduce((sum, item) => sum + item.size, 0),
        items, issues: structuredClone(resolution.graph.issues) };
      if (Buffer.byteLength(JSON.stringify(body)) > 2 * 1024 ** 2) throw new ModContractError('MOD_LIMIT');
      return { ...body, planId: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
    } catch (error) {
      if (signal?.aborted) throw new ModContractError('CANCELLED');
      throw error;
    } finally { this.active = false; }
  }
}
