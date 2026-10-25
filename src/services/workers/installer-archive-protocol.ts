import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import type { SelectedArchiveInput } from '../install/native-archive.js';
import { NATIVE_CODES } from './native-protocol.js';
import type { NativeCode } from './native-protocol.js';

export const INSTALLER_ENTRIES = ['install_profile.json', 'version.json', 'data/client.lzma'] as const;
export interface InstallerArchiveRequest extends SelectedArchiveInput { version: 1; kind: 'loader-installer-extract'; destination: string }
export type InstallerArchiveReply = { version: 1; kind: 'loader-installer-result'; files: 3; bytes: number }
  | { version: 1; kind: 'loader-installer-failed'; code: NativeCode };
const absolute = (value: unknown): value is string => typeof value === 'string' && value.length <= 32760 && path.isAbsolute(value);

/** Accepts only one verified installer and the fixed three-entry extraction operation. */
export function parseInstallerArchiveRequest(value: unknown): InstallerArchiveRequest {
  if (!exactObject(value, ['version', 'kind', 'destination', 'file', 'sha256', 'size']) || value.version !== 1
    || value.kind !== 'loader-installer-extract' || !absolute(value.destination) || !absolute(value.file)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 64 * 1024 ** 2) throw new Error('INVALID_ARCHIVE');
  return value as unknown as InstallerArchiveRequest;
}

export function parseInstallerArchiveReply(value: unknown): InstallerArchiveReply {
  if (exactObject(value, ['version', 'kind', 'files', 'bytes']) && value.version === 1 && value.kind === 'loader-installer-result'
    && value.files === 3 && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= 64 * 1024 ** 2) return value as InstallerArchiveReply;
  if (exactObject(value, ['version', 'kind', 'code']) && value.version === 1 && value.kind === 'loader-installer-failed'
    && typeof value.code === 'string' && NATIVE_CODES.includes(value.code as NativeCode)) return value as InstallerArchiveReply;
  throw new Error('INVALID_ARCHIVE');
}
