import { createHash } from 'node:crypto';
import path from 'node:path';
import type { WebFileKind, WebPackPreview } from '../../shared/contracts/web-extensions.js';
import { isWebPackPreview } from '../../shared/contracts/web-extensions.js';
import { inspectWebArchiveBytes, NativeArchiveError } from '../install/native-archive.js';
import { guardDirectory, readRegular } from '../storage/files.js';

export const MAX_INSPECT_BYTES = 64 * 1024 ** 2;
export interface WebFileProof {
  kind: WebFileKind; size: number; sha256: string; sha512: string; sha1: string; archiveRejected: boolean; packPreview?: WebPackPreview;
}

function json(data: Buffer | undefined): Record<string, unknown> | undefined {
  if (!data) return;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { return; }
}

function summarizePack(metadata: Buffer | undefined, entries: string[]): WebPackPreview | undefined {
  const pack = json(metadata);
  if (!pack || pack.formatVersion !== 1 || pack.game !== 'minecraft' || typeof pack.name !== 'string'
    || !Array.isArray(pack.files) || pack.files.length > 512 || typeof pack.dependencies !== 'object'
    || pack.dependencies === null || Array.isArray(pack.dependencies)) return;
  const dependencies = pack.dependencies as Record<string, unknown>;
  const loaders = Object.entries(dependencies).filter(([name]) => name !== 'minecraft');
  let required = 0; let optional = 0;
  for (const file of pack.files) {
    if (typeof file !== 'object' || !file || typeof file.path !== 'string') return;
    const env: unknown = file.env;
    if (typeof env === 'object' && env && 'client' in env) {
      if (env.client === 'unsupported') continue;
      if (env.client === 'optional') { optional++; continue; }
      if (env.client !== 'required') return;
    }
    required++;
  }
  const result = {
    name: pack.name.replace(/[\p{C}]/gu, ' ').trim().slice(0, 80), minecraft: dependencies.minecraft,
    loader: loaders.length ? loaders.map(([name, revision]) => `${name} ${typeof revision === 'string' ? revision : ''}`.trim()).join(', ').slice(0, 160) : 'vanilla',
    required, optional, overrides: entries.filter(name => /^(?:client-)?overrides\//.test(name)).length,
  };
  return isWebPackPreview(result) ? result : undefined;
}

/** Bounded structural recognition. An archive name or MIME declaration does not determine its install kind. */
export function classifyWebFile(filename: string, bytes: Buffer): Pick<WebFileProof, 'kind' | 'archiveRejected' | 'packPreview'> {
  const lower = filename.toLowerCase();
  let kind: WebFileKind = 'unknown';
  if (lower.endsWith('.png') && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) === 64
    && [32, 64].includes(bytes.readUInt32BE(20))) kind = 'skin';
  if (!/\.(jar|zip|mrpack)$/.test(lower)) return { kind, archiveRejected: false };
  try {
    const { names, packMetadata, modrinthMetadata } = inspectWebArchiveBytes(bytes);
    const packPreview = lower.endsWith('.mrpack') ? summarizePack(modrinthMetadata, names) : undefined;
    if (packPreview) return { kind: 'modpack', archiveRejected: false, packPreview };
    if (lower.endsWith('.mrpack')) return { kind: 'unknown', archiveRejected: true };
    if (lower.endsWith('.zip') && typeof json(packMetadata)?.pack === 'object' && names.some(name => name.startsWith('assets/'))) kind = 'resourcepack';
    if (lower.endsWith('.zip') && names.some(name => /^shaders\/.+\.(?:vsh|fsh|csh|gsh|glsl)$/i.test(name))) kind = 'shader';
    if (lower.endsWith('.jar') && names.some(name => ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml'].includes(name))) kind = 'mod';
    return { kind, archiveRejected: false };
  } catch (error) {
    if (!(error instanceof NativeArchiveError)) throw error;
    return { kind: 'unknown', archiveRejected: true };
  }
}

/** Reads a bounded private download in an off-main worker and records independently computed hashes. */
export async function inspectWebFile(file: string, name: string): Promise<WebFileProof> {
  await guardDirectory(path.dirname(file));
  const bytes = await readRegular(file, MAX_INSPECT_BYTES);
  if (!bytes || bytes.length === 0) throw new Error('WEB_FILE_UNAVAILABLE');
  return { ...classifyWebFile(name, bytes), size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), sha512: createHash('sha512').update(bytes).digest('hex'),
    sha1: createHash('sha1').update(bytes).digest('hex') };
}
