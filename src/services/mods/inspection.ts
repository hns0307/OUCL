import { checkPlatformMods } from '../../core/mods/platform.js';
import type { DualModCheck, PlatformLocalMod, PlatformModVersion } from '../../core/mods/platform.js';
import type { ModInventory, ModInventoryContext, ModInventoryService } from './inventory.js';
import { ModInventoryError } from './inventory.js';
import type { ModrinthModClient, ModPlatformCode } from './modrinth.js';
import { ModPlatformError } from './modrinth.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';

export interface ModInspection { inventory: ModInventory; platform: DualModCheck; platformFailures: ModPlatformCode[] }
export type ModInspectionStage = 'local' | 'platform' | 'rechecking' | 'completed';

/** Orchestrates real local and platform evidence with a final fresh file observation; performs no installation writes. */
export class ModInspectionService {
  private active = false;
  constructor(private readonly context: (instanceId: string, signal?: AbortSignal) => Promise<ModInventoryContext>,
    private readonly inventory: Pick<ModInventoryService, 'scan'>, private readonly platform: Pick<ModrinthModClient, 'byHashes'>) {}

  async check(instanceId: string, expectedRevision: number, signal?: AbortSignal,
    progress?: (stage: ModInspectionStage) => Promise<void>): Promise<ModInspection> {
    if (!UUID_PATTERN.test(instanceId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ModInventoryError('INVALID_ARGUMENT');
    instanceId = instanceId.toLowerCase();
    if (this.active) throw new ModInventoryError('SCAN_BUSY'); this.active = true;
    const cancelled = (): void => { if (signal?.aborted) throw new ModInventoryError('CANCELLED'); };
    try {
      cancelled(); await progress?.('local'); const initial = await this.inventory.scan(instanceId, expectedRevision, signal); cancelled();
      const context = await this.context(instanceId, signal); const contextSnapshot = JSON.stringify(context);
      if (context.instanceId !== instanceId || context.revision !== expectedRevision) throw new ModInventoryError('REVISION_CONFLICT');
      const hashes = [...new Set(initial.items.flatMap(item => item.sha512 ? [item.sha512] : []))];
      const versions = new Map<string, PlatformModVersion>(); const platformFailures: ModPlatformCode[] = []; let bytes = 0;
      await progress?.('platform');
      for (let offset = 0; offset < hashes.length; offset += 64) {
        cancelled();
        try {
          const matched = await this.platform.byHashes(hashes.slice(offset, offset + 64), signal); cancelled();
          for (const [hash, version] of matched) {
            bytes += Buffer.byteLength(JSON.stringify(version)); if (bytes > 8 * 1024 ** 2) throw new ModPlatformError('PLATFORM_LIMIT');
            versions.set(hash, version);
          }
        } catch (error) {
          cancelled(); if (!(error instanceof ModPlatformError)) throw error;
          if (error.code === 'CANCELLED') throw new ModInventoryError('CANCELLED');
          platformFailures.push(error.code); break;
        }
      }
      cancelled(); await progress?.('rechecking');
      const final = await this.inventory.scan(instanceId, expectedRevision, signal); cancelled();
      if (initial.fingerprint !== final.fingerprint) throw new ModInventoryError('FILES_CHANGED');
      if (JSON.stringify(await this.context(instanceId, signal)) !== contextSnapshot) throw new ModInventoryError('REVISION_CONFLICT');
      const local: PlatformLocalMod[] = final.items.map(item => ({ fileId: item.fileId, enabled: item.enabled, size: item.size, sha1: item.sha1,
        sha512: item.sha512, formats: item.archives.find(archive => !archive.entries.length)?.declarations.map(declaration => declaration.format) ?? [],
        unresolvedEmbedded: item.archives.some(archive => archive.jarJar || archive.entries.length > 0) }));
      const platform = checkPlatformMods(final.local.state, local, context.environment, versions);
      if (platformFailures.length && platform.state === 'satisfied') platform.state = 'unknown';
      cancelled(); await progress?.('completed'); cancelled(); return { inventory: final, platform, platformFailures };
    } finally { this.active = false; }
  }
}
