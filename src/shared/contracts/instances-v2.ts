import { exactObject, UUID_PATTERN } from './handshake.js';
import { loaderKind, loaderVersion } from './loaders.js';
import type { LoaderKind } from './loaders.js';

export const INSTANCES_V2_CAPABILITY = 'instances.v2' as const;
export interface InstanceLoaderIdentity { kind: 'vanilla' | LoaderKind; version?: string }
export interface InstanceV2Summary {
  instanceId: string; displayName: string; minecraftVersion: string; loader: InstanceLoaderIdentity;
  isolation: 'on' | 'off'; state: 'installing' | 'ready' | 'failed' | 'cancelled' | 'needsRecovery'; revision: number;
}

function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function displayName(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && value.trim() === value && !/[\p{C}]/u.test(value);
}
export function isInstanceLoaderIdentity(value: unknown): value is InstanceLoaderIdentity {
  if (exactObject(value, ['kind'])) return value.kind === 'vanilla';
  return exactObject(value, ['kind', 'version']) && loaderKind(value.kind) && loaderVersion(value.version);
}
/** Validates the v2 public projection; no root, task, local path or raw metadata is exposed. */
export function isInstanceV2Summary(value: unknown): value is InstanceV2Summary {
  return exactObject(value, ['instanceId', 'displayName', 'minecraftVersion', 'loader', 'isolation', 'state', 'revision'])
    && typeof value.instanceId === 'string' && UUID_PATTERN.test(value.instanceId) && displayName(value.displayName)
    && loaderVersion(value.minecraftVersion) && isInstanceLoaderIdentity(value.loader)
    && (value.isolation === 'on' || value.isolation === 'off') && typeof value.state === 'string'
    && ['installing', 'ready', 'failed', 'cancelled', 'needsRecovery'].includes(value.state)
    && integer(value.revision) && value.revision > 0;
}
