import { previewModMaintenance } from '../../core/mods/maintenance-impact.js';
import type { MaintenanceImpact } from '../../core/mods/maintenance-impact.js';
import type { PlatformModVersion } from '../../core/mods/platform.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { ModContractError } from '../../shared/contracts/mods.js';
import { platformFacts } from './facts.js';
import { modInventoryFingerprint } from './inventory.js';
import type { ModInventoryContext } from './inventory.js';
import type { ModInspectionService } from './inspection.js';
import type { ModPlatformCode } from './modrinth.js';

export interface MaintenancePreviewInput {
  rootId: string; instanceId: string; expectedRevision: number; expectedFingerprint: string;
  fileId: string; action: 'enable' | 'disable';
}
export interface MaintenancePreviewContext { rootId: string; inventory: ModInventoryContext }
export interface MaintenancePreview {
  rootId: string; instanceId: string; instanceRevision: number; fingerprint: string;
  filename: string; sha256: string | null; impact: MaintenanceImpact; platformFailures: ModPlatformCode[];
}
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Private, read-only maintenance preview. The resolver is main-owned and never accepts a file path.
 * Reuses the inspection service's fresh two-scan check, then rechecks root/environment identity.
 * No operation handle, durable authorization, ownership claim or filesystem write is produced.
 */
export class ModMaintenancePreviewService {
  private active = false;
  constructor(private readonly context: (instanceId: string, signal?: AbortSignal) => Promise<MaintenancePreviewContext>,
    private readonly inspection: Pick<ModInspectionService, 'check'>) {}

  /** Rejects stale report selection even when the same filename retains its old inventory fileId. */
  async preview(input: MaintenancePreviewInput, signal?: AbortSignal): Promise<MaintenancePreview> {
    if (!UUID_PATTERN.test(input.rootId) || !UUID_PATTERN.test(input.instanceId)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
      || !hex(input.expectedFingerprint) || !hex(input.fileId) || input.action !== 'enable' && input.action !== 'disable') {
      throw new ModContractError('INVALID_ARGUMENT');
    }
    if (this.active) throw new ModContractError('SCAN_BUSY');
    const request = structuredClone(input); request.rootId = request.rootId.toLowerCase(); request.instanceId = request.instanceId.toLowerCase();
    const cancelled = (): void => { if (signal?.aborted) throw new ModContractError('CANCELLED'); };
    const validateContext = (context: MaintenancePreviewContext): void => {
      if (context.rootId !== request.rootId) throw new ModContractError('ROOT_UNAVAILABLE');
      if (context.inventory.instanceId !== request.instanceId || context.inventory.revision !== request.expectedRevision) {
        throw new ModContractError('REVISION_CONFLICT');
      }
    };
    this.active = true;
    try {
      cancelled(); const before = structuredClone(await this.context(request.instanceId, signal)); cancelled(); validateContext(before);
      const inspected = await this.inspection.check(request.instanceId, request.expectedRevision, signal); cancelled();
      const inventory = inspected.inventory;
      if (inventory.instanceId !== request.instanceId || inventory.revision !== request.expectedRevision) throw new ModContractError('REVISION_CONFLICT');
      if (inventory.fingerprint !== request.expectedFingerprint
        || modInventoryFingerprint(inventory.instanceId, inventory.revision, inventory.items) !== inventory.fingerprint) {
        throw new ModContractError('FILES_CHANGED');
      }
      const selected = inventory.items.find(file => file.fileId === request.fileId);
      if (!selected || selected.enabled === (request.action === 'enable')) throw new ModContractError('INVALID_ARGUMENT');
      const versions = new Map<string, PlatformModVersion>();
      for (const association of inspected.platform.files) {
        const file = inventory.items.find(item => item.fileId === association.fileId);
        if (file?.sha512 && association.version) versions.set(file.sha512, association.version);
      }
      const facts = platformFacts(inventory.items);
      const impact = previewModMaintenance(inventory.items.map((file, index) => ({ ...file, platform: facts[index]! })),
        before.inventory.environment, versions, request.fileId, request.action);
      // Transport failure is not evidence that platform constraints are satisfied, even after disabling a file.
      if (inspected.platformFailures.length && impact.state === 'ready') impact.state = 'unknown';
      const after = await this.context(request.instanceId, signal); cancelled(); validateContext(after);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new ModContractError('REVISION_CONFLICT');
      return structuredClone({ rootId: request.rootId, instanceId: request.instanceId, instanceRevision: request.expectedRevision,
        fingerprint: inventory.fingerprint, filename: selected.filename, sha256: selected.sha256, impact,
        platformFailures: inspected.platformFailures });
    } finally { this.active = false; }
  }
}
