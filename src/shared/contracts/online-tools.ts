import { exactObject, UUID_PATTERN } from './handshake.js';
import type { ErrorCategory } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const ONLINE_TOOLS_CAPABILITY = 'tools.isolated.v1' as const;
export const ONLINE_TOOLS_CHANNELS = ['tools:state', 'tools:open', 'tools:retry', 'tools:close'] as const;
export type OnlineToolChannel = typeof ONLINE_TOOLS_CHANNELS[number];
export const TOOL_ID = /^[a-z][a-z0-9-]{0,47}$/;
export const ONLINE_TOOL_PHASES = ['closed', 'loading', 'ready', 'failed', 'closing'] as const;
export interface OnlineToolSnapshot { revision: number; phase: typeof ONLINE_TOOL_PHASES[number]; toolId?: string; code?: string }
export interface OnlineToolsData { tools: Array<{ toolId: string; title: string }>; snapshot: OnlineToolSnapshot }
export type OnlineToolCode = 'INVALID_ARGUMENT' | 'INVALID_SENDER' | 'UNSUPPORTED_CONTRACT' | 'UNAVAILABLE' | 'TIMEOUT' | 'REQUEST_CONFLICT' | 'TOOL_NOT_FOUND';
export interface OnlineToolError { category: ErrorCategory; code: OnlineToolCode; messageKey: MessageKey; retryable: boolean; traceId: string }
export type OnlineToolsResult = { contractVersion: 1; requestId: string; ok: true; data: OnlineToolsData }
  | { contractVersion: 1; requestId: string; ok: false; error: OnlineToolError };
export interface OnlineToolsBridge {
  onlineToolState(): Promise<OnlineToolsResult>;
  openOnlineTool(requestId: string, toolId: string): Promise<OnlineToolsResult>;
  retryOnlineTool(requestId: string): Promise<OnlineToolsResult>;
  closeOnlineTool(requestId: string): Promise<OnlineToolsResult>;
}
const ERRORS: Record<OnlineToolCode, { category: ErrorCategory; messageKey: MessageKey; retryable: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  INVALID_SENDER: { category: 'permission', messageKey: 'invalidSender', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', messageKey: 'unsupportedContract', retryable: false },
  UNAVAILABLE: { category: 'system', messageKey: 'unavailable', retryable: true },
  TIMEOUT: { category: 'system', messageKey: 'timeout', retryable: true },
  REQUEST_CONFLICT: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  TOOL_NOT_FOUND: { category: 'biz', messageKey: 'onlineToolsUnconfigured', retryable: false },
};
/** Public failures contain fixed messages, never a remote URL or platform exception. */
export function onlineToolFailure(requestId: string, code: OnlineToolCode, traceId: string): OnlineToolsResult {
  return { contractVersion: 1, requestId, ok: false, error: { ...ERRORS[code], code, traceId } };
}
/** Tools accept a fixed identifier only; layout, scripts, URLs and permissions are main-owned. */
export function isOnlineToolPayload(channel: OnlineToolChannel, value: unknown): value is { toolId?: string } {
  return channel === 'tools:open' ? exactObject(value, ['toolId']) && typeof value.toolId === 'string' && TOOL_ID.test(value.toolId) : exactObject(value, []);
}
/** Validate every public DTO including optional keys and bounded registry entries. */
export function isOnlineToolsData(value: unknown): value is OnlineToolsData {
  if (!exactObject(value, ['tools', 'snapshot']) || !Array.isArray(value.tools) || value.tools.length > 16
    || !value.tools.every(item => exactObject(item, ['toolId', 'title']) && typeof item.toolId === 'string' && TOOL_ID.test(item.toolId)
      && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 80 && !Array.from(item.title).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    || new Set(value.tools.map(item => (item as { toolId: string }).toolId)).size !== value.tools.length) return false;
  const state = value.snapshot;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const optional = Object.keys(state).filter(key => key === 'toolId' || key === 'code');
  return exactObject(state, ['revision', 'phase', ...optional]) && typeof state.revision === 'number' && Number.isSafeInteger(state.revision) && state.revision >= 0
    && ONLINE_TOOL_PHASES.includes(state.phase as OnlineToolSnapshot['phase'])
    && (state.toolId === undefined || typeof state.toolId === 'string' && TOOL_ID.test(state.toolId))
    && (state.code === undefined || typeof state.code === 'string' && ['TOOL_NOT_FOUND', 'LOAD_FAILED', 'VIEW_FAILED', 'CLEANUP_FAILED'].includes(state.code));
}
/** Validates an exact versioned result before preload exposes it to the page. */
export function isOnlineToolsResult(value: unknown, requestId: string): value is OnlineToolsResult {
  if (!UUID_PATTERN.test(requestId) || !exactObject(value, value && typeof value === 'object' && 'ok' in value && value.ok === true
    ? ['contractVersion', 'requestId', 'ok', 'data'] : ['contractVersion', 'requestId', 'ok', 'error']) || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === true) return isOnlineToolsData(value.data);
  if (value.ok !== false || !exactObject(value.error, ['category', 'code', 'messageKey', 'retryable', 'traceId'])
    || typeof value.error.code !== 'string' || !Object.hasOwn(ERRORS, value.error.code) || typeof value.error.traceId !== 'string' || !UUID_PATTERN.test(value.error.traceId)) return false;
  const expected = ERRORS[value.error.code as OnlineToolCode];
  return value.error.category === expected.category && value.error.messageKey === expected.messageKey && value.error.retryable === expected.retryable;
}
