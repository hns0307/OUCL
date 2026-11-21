import type { DesktopBridge } from './desktop.js';
import type { ResourcesBridge } from './resources.js';
import type { MessageKey } from '../locales/messages.js';
import type { RootsBridge } from './roots.js';
import type { CatalogBridge } from './catalog.js';
import type { InstanceBridge } from './instances.js';
import type { ProfilesBridge } from './profiles.js';
import type { GameBridge } from './game.js';
import type { LoadersBridge } from './loaders.js';
import type { InstancesV2Bridge } from './instances-v2.js';
import type { ModsBridge } from './mods.js';
import type { InstanceFoldersBridge } from './instance-folders.js';
import type { TargetBridge } from './task-targets.js';
import type { MaintenancePreviewBridge } from './mod-maintenance-preview.js';
import type { PacksBridge } from './packs.js';
import type { OnlineToolsBridge } from './online-tools.js';
import type { DistributionBridge } from './distribution-preview.js';
import type { DistributionExecutionBridge } from './distribution-execution.js';
import type { OnlineAccountsBridge } from './online-accounts.js';
import type { SkinBridge } from './skin.js';
import type { WebExtensionsBridge } from './web-extensions.js';
import type { MultiplayerBridge } from './multiplayer.js';

export const CONTRACT_VERSION = 1 as const;
export const HANDSHAKE_CHANNEL = 'app:handshake' as const;
export const HANDSHAKE_TIMEOUT_MS = 3000;
export const CAPABILITIES = ['roots.v1', 'catalog.v1', 'instances.v1', 'instances.v2', 'instance-folders.v1', 'tasks.v1', 'task-targets.v1', 'java.v1', 'accounts.v1', 'settings.v1', 'game.v1', 'sessions.v1', 'resources.v1', 'loaders.v1', 'mods.v1', 'mods-maintenance-preview.v1', 'downloads.v1', 'desktop.v1', 'packs.fixed-preview.v1', 'tools.isolated.v1', 'distribution.preview.v1', 'distribution.execute.v1', 'accounts.online.v1', 'skin.v1', 'web-extensions.v1', 'multiplayer.v1'] as const;
export type Capability = typeof CAPABILITIES[number];
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ErrorCategory = 'system' | 'minecraft' | 'network' | 'biz' | 'validation' | 'auth' | 'permission' | 'disk' | 'cancelled';
export type HandshakeErrorCode = 'INVALID_ARGUMENT' | 'UNSUPPORTED_CONTRACT' | 'INVALID_SENDER' | 'TIMEOUT' | 'UNAVAILABLE';

export interface AppError {
  category: ErrorCategory;
  code: HandshakeErrorCode;
  messageKey: MessageKey;
  retryable: boolean;
  traceId: string;
}
export interface HandshakeRequest {
  contractVersion: 1;
  requestId: string;
  payload: { supportedVersions: number[] };
}
export interface HandshakeData {
  selectedVersion: 1;
  capabilities: string[];
  sessionId: string;
}
export type HandshakeResult = { contractVersion: 1; requestId: string; ok: true; data: HandshakeData }
  | { contractVersion: 1; requestId: string; ok: false; error: AppError };
export interface LauncherBridge extends RootsBridge, InstancesV2Bridge, InstanceFoldersBridge, CatalogBridge, InstanceBridge, ProfilesBridge, GameBridge, ResourcesBridge, LoadersBridge, ModsBridge, DesktopBridge, TargetBridge, PacksBridge, MaintenancePreviewBridge, OnlineToolsBridge, DistributionBridge, DistributionExecutionBridge, OnlineAccountsBridge, SkinBridge, WebExtensionsBridge, MultiplayerBridge { handshake(): Promise<HandshakeResult> }

/** Accepts a plain DTO with exact keys, excluding arrays and null. */
export function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Rejects unknown fields, unsupported envelope versions and invalid version lists. */
export function isHandshakeRequest(value: unknown): value is HandshakeRequest {
  if (!exactObject(value, ['contractVersion', 'requestId', 'payload'])) return false;
  if (value.contractVersion !== CONTRACT_VERSION || typeof value.requestId !== 'string' || !UUID_PATTERN.test(value.requestId)) return false;
  const payload = value.payload;
  return exactObject(payload, ['supportedVersions']) && Array.isArray(payload.supportedVersions)
    && payload.supportedVersions.length >= 1 && payload.supportedVersions.length <= 4
    && payload.supportedVersions.every((item: unknown) => typeof item === 'number' && Number.isSafeInteger(item) && item > 0);
}

/** Validates the only response DTO exposed by the empty application. */
export function isHandshakeResult(value: unknown, requestId: string): value is HandshakeResult {
  if (!exactObject(value, value && typeof value === 'object' && 'ok' in value && value.ok === true
    ? ['contractVersion', 'requestId', 'ok', 'data'] : ['contractVersion', 'requestId', 'ok', 'error'])) return false;
  if (value.contractVersion !== CONTRACT_VERSION || value.requestId !== requestId) return false;
  if (value.ok === true) {
    return exactObject(value.data, ['selectedVersion', 'capabilities', 'sessionId'])
      && value.data.selectedVersion === 1 && Array.isArray(value.data.capabilities) && value.data.capabilities.length <= CAPABILITIES.length
      && new Set(value.data.capabilities).size === value.data.capabilities.length
      && value.data.capabilities.every((item: unknown) => CAPABILITIES.includes(item as Capability))
      && typeof value.data.sessionId === 'string' && UUID_PATTERN.test(value.data.sessionId);
  }
  if (value.ok !== false || !exactObject(value.error, ['category', 'code', 'messageKey', 'retryable', 'traceId'])) return false;
  const errors: Record<HandshakeErrorCode, { category: ErrorCategory; key: MessageKey }> = {
    INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument' },
    UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract' },
    INVALID_SENDER: { category: 'permission', key: 'invalidSender' },
    TIMEOUT: { category: 'system', key: 'timeout' },
    UNAVAILABLE: { category: 'system', key: 'unavailable' },
  };
  const error = value.error;
  if (typeof error.code !== 'string' || !Object.hasOwn(errors, error.code)) return false;
  const expected = errors[error.code as HandshakeErrorCode];
  return error.category === expected.category && error.messageKey === expected.key
    && typeof error.retryable === 'boolean' && typeof error.traceId === 'string' && UUID_PATTERN.test(error.traceId);
}
