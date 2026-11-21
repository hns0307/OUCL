import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { OfficialMetadataReader } from '../catalog/transport.js';
import type { MetadataReader } from '../catalog/transport.js';
import type { DownloadSpec } from '../download/types.js';
import { isArtifactUrl } from '../download/types.js';
import { installRelativePath } from '../../core/install/assets.js';
import { JavaProbe } from './probe.js';
import type { ProfileService } from '../launch/profiles.js';
import type { RegisteredJava } from '../storage/launch-profiles.js';
import { JAVA_PROBE_TIMEOUT_MS, registeredJavaCandidates } from './selection.js';

export const JAVA_INDEX = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const COMPONENTS = { 8: 'jre-legacy', 17: 'java-runtime-gamma', 21: 'java-runtime-delta' } as const;
export interface JavaFile { relative: string; spec: DownloadSpec }
export interface JavaPackage { digest: string; files: JavaFile[] }
export interface JavaInstaller { prepareJava(pack: JavaPackage, consumerId: string, signal: AbortSignal): Promise<string> }
export class JavaRuntimeError extends Error {
  readonly category = 'system';
  constructor(readonly code: 'JAVA_INCOMPATIBLE' | 'CANCELLED' | 'NEEDS_RECOVERY' = 'JAVA_INCOMPATIBLE') { super(code); }
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Only the pinned Java index and official content-addressed runtime manifests are metadata inputs. */
export function isJavaMetadataUrl(value: string): boolean {
  return value === JAVA_INDEX || /^https:\/\/piston-meta\.mojang\.com\/v1\/packages\/[a-f0-9]{40}\/manifest\.json$/.test(value);
}
/** Parses ordinary Windows runtime files. Links, case aliases and file/directory collisions are refused. */
export function parseJavaPackage(value: unknown, digest: string): JavaPackage {
  if (!object(value) || !object(value.files) || !/^[a-f0-9]{40}$/.test(digest)) throw new JavaRuntimeError();
  const entries = Object.entries(value.files); const names = new Map<string, string>(); const files: JavaFile[] = [];
  if (!entries.length || entries.length > 10000) throw new JavaRuntimeError();
  let total = 0;
  for (const [relative, entry] of entries) {
    try { installRelativePath(relative); } catch { throw new JavaRuntimeError(); }
    if (!object(entry) || !['directory', 'file'].includes(String(entry.type)) || names.has(relative.toLowerCase())) throw new JavaRuntimeError();
    names.set(relative.toLowerCase(), String(entry.type));
    if (entry.type === 'directory') continue;
    const raw = object(entry.downloads) ? entry.downloads.raw : undefined;
    if (!object(raw) || typeof raw.url !== 'string' || !isArtifactUrl(raw.url) || new URL(raw.url).hostname !== 'piston-data.mojang.com'
      || typeof raw.sha1 !== 'string' || !/^[a-f0-9]{40}$/.test(raw.sha1) || typeof raw.size !== 'number'
      || !Number.isSafeInteger(raw.size) || raw.size < 0 || raw.size > 512 * 1024 ** 2) throw new JavaRuntimeError();
    total += raw.size; if (total > 1024 ** 3) throw new JavaRuntimeError();
    files.push({ relative, spec: { url: raw.url, expected: { algorithm: 'sha1', digest: raw.sha1, size: raw.size, provenanceId: `java:${digest}` },
      anchor: { kind: 'mojang-runtime', algorithm: 'sha1', digest } } });
  }
  for (const name of names.keys()) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { if (names.get(parts.join('/')) === 'file') throw new JavaRuntimeError(); parts.pop(); }
  }
  if (!files.some(file => file.relative === 'bin/java.exe')) throw new JavaRuntimeError();
  return { digest, files };
}

/** Main-process only: discovers bounded common locations, then prepares official Java on demand. */
export class JavaRuntimeService {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly profiles: Pick<ProfileService, 'list' | 'registerJava'>, private readonly installer: JavaInstaller,
    private readonly reader: MetadataReader = new OfficialMetadataReader(fetch, isJavaMetadataUrl), private readonly probe = new JavaProbe(),
    private readonly environment: NodeJS.ProcessEnv = process.env) {}
  /** Serial preparation avoids concurrent publication of the same immutable runtime. */
  ensure(major: number, consumerId: string, signal: AbortSignal): Promise<RegisteredJava> {
    const run = this.tail.then(() => this.prepare(major, consumerId, signal)); this.tail = run.then(() => {}, () => {}); return run;
  }
  private async prepare(major: number, consumerId: string, signal: AbortSignal): Promise<RegisteredJava> {
    const check = (): void => { if (signal.aborted) throw new JavaRuntimeError('CANCELLED'); }; check();
    if (major !== 8 && major !== 17 && major !== 21) throw new JavaRuntimeError();
    const saved = await this.profiles.list();
    const candidates = registeredJavaCandidates(saved, major).map(java => java.executable);
    const env = this.environment;
    for (const key of ['JAVA_HOME', 'JDK_HOME']) if (env[key]) candidates.push(path.join(env[key]!, 'bin/java.exe'));
    for (const base of [env.ProgramFiles && path.join(env.ProgramFiles, 'Java'), env.ProgramFiles && path.join(env.ProgramFiles, 'Eclipse Adoptium'),
      env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft'), env.APPDATA && path.join(env.APPDATA, '.minecraft/runtime')]) {
      if (!base) continue;
      try {
        for (const item of (await readdir(base, { withFileTypes: true })).slice(0, 64)) if (item.isDirectory() && !item.isSymbolicLink()) {
          candidates.push(path.join(base, item.name, 'bin/java.exe'));
          // Mojang launcher's runtime layout adds platform and component directories.
          candidates.push(path.join(base, item.name, 'windows-x64', item.name, 'bin/java.exe'));
        }
      } catch { /* An absent or inaccessible candidate directory is not a Java installation. */ }
    }
    for (const executable of [...new Set(candidates)].slice(0, 128)) {
      check();
      let measured;
      try { measured = await this.probe.probe(executable, { signal, timeoutMs: JAVA_PROBE_TIMEOUT_MS }); } catch { check(); }
      if (measured?.major === major) {
        check(); const registered = await this.profiles.registerJava(executable, signal, saved); check();
        if (registered.version !== measured.version || registered.major !== measured.major) throw new JavaRuntimeError();
        return registered;
      }
    }
    check(); const index = JSON.parse((await this.reader.read(JAVA_INDEX)).body) as unknown; check();
    const platforms = object(index) ? index['windows-x64'] : undefined;
    const component = object(platforms) ? platforms[COMPONENTS[major]] : undefined;
    if (!Array.isArray(component) || !object(component[0]) || !object(component[0].manifest)) throw new JavaRuntimeError();
    const manifest = component[0].manifest;
    if (typeof manifest.url !== 'string' || !isJavaMetadataUrl(manifest.url) || manifest.url === JAVA_INDEX
      || typeof manifest.sha1 !== 'string' || !/^[a-f0-9]{40}$/.test(manifest.sha1)
      || !manifest.url.includes(`/${manifest.sha1}/`)) throw new JavaRuntimeError();
    const document = await this.reader.read(manifest.url, manifest.sha1); check();
    const pack = parseJavaPackage(JSON.parse(document.body) as unknown, manifest.sha1);
    const executable = await this.installer.prepareJava(pack, consumerId, signal); check();
    const runtime = await this.probe.probe(executable, { signal }); if (runtime.major !== major) throw new JavaRuntimeError();
    check(); const registered = await this.profiles.registerJava(executable, signal, saved); check();
    if (registered.version !== runtime.version || registered.major !== runtime.major) throw new JavaRuntimeError();
    return registered;
  }
}
