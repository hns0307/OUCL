import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractSelectedArchive } from '../install/native-archive.js';
import { guardDirectory, readRegular } from '../storage/files.js';

export const ENGINE_SHA256 = '27af91e270e554709b048bd32327fefd2dfce5062ae1e8701af7550c6f525f84';
export const MAX_ENGINE_ZIP = 64 * 1024 * 1024;
const PACKAGE_DIRECTORY = 'easytier-windows-x86_64';
const BINARIES = ['easytier-core.exe', 'easytier-cli.exe', 'Packet.dll', 'wintun.dll'] as const;

/** Commits only a verified upstream ZIP. Executables are reconstructed in a fresh directory for every room. */
export async function importEngineZip(input: string, destination: string): Promise<void> {
  await guardDirectory(path.dirname(input));
  await guardDirectory(path.dirname(destination));
  const bytes = await readRegular(input, MAX_ENGINE_ZIP);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== ENGINE_SHA256) throw new Error('ENGINE_INVALID');
  const temporary = path.join(path.dirname(destination), '.import-' + randomUUID());
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Extracts only the engine tools and their DLLs from the fixed-digest official archive. */
export async function prepareEngine(zip: string, workspace: string, size: number): Promise<void> {
  await extractSelectedArchive(workspace, { file: zip, sha256: ENGINE_SHA256, size }, BINARIES.map(name => PACKAGE_DIRECTORY + '/' + name));
}
export function engineExecutable(workspace: string, role: 'core' | 'cli'): string {
  return path.join(workspace, PACKAGE_DIRECTORY, role === 'core' ? BINARIES[0] : BINARIES[1]);
}
export async function makeEngineDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  return guardDirectory(directory);
}
export async function createRuntimeDirectory(directory: string): Promise<string> {
  return mkdtemp(path.join(await guardDirectory(directory), 'runtime-'));
}
/** Removes only a workspace created as an immediate child of the private engine directory. */
export async function removeRuntimeDirectory(directory: string, workspace: string): Promise<void> {
  if (path.resolve(path.dirname(workspace)) !== path.resolve(directory) || !/^runtime-[A-Za-z0-9]{6}$/.test(path.basename(workspace))) return;
  await guardDirectory(workspace);
  await rm(workspace, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 });
}
