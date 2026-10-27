import type { LoaderKind } from './loaders.js';

export interface LoaderInstallTarget { readonly minecraftVersion: string; readonly loaderVersion: string; readonly javaMajor: 17 | 21 }
/** Approved representative targets. These constants do not assert successful runtime verification. */
export const LOADER_INSTALL_TARGETS: Readonly<Record<LoaderKind, LoaderInstallTarget>> = Object.freeze({
  fabric: Object.freeze({ minecraftVersion: '1.20.1', loaderVersion: '0.16.14', javaMajor: 17 }),
  quilt: Object.freeze({ minecraftVersion: '1.20.1', loaderVersion: '0.29.2', javaMajor: 17 }),
  forge: Object.freeze({ minecraftVersion: '1.20.1', loaderVersion: '47.4.28', javaMajor: 17 }),
  neoforge: Object.freeze({ minecraftVersion: '1.21.1', loaderVersion: '21.1.265', javaMajor: 21 }),
});

/** Processor recipes are restricted to their implemented Minecraft series; metadata loaders retain other unverified combinations. */
export function canInstallLoaderMinecraft(kind: LoaderKind, minecraftVersion: string): boolean {
  return kind !== 'forge' && kind !== 'neoforge' || minecraftVersion === LOADER_INSTALL_TARGETS[kind].minecraftVersion;
}

/** Prefers the stable representative only when actually returned for this Minecraft; never auto-selects a prerelease. */
export function preferredLoaderVersion(kind: LoaderKind, minecraftVersion: string,
  versions: readonly { loaderVersion: string; stable: boolean }[]): string {
  const target = LOADER_INSTALL_TARGETS[kind];
  if (minecraftVersion === target.minecraftVersion) {
    const found = versions.find(item => item.stable && item.loaderVersion === target.loaderVersion);
    if (found) return found.loaderVersion;
  }
  return versions.find(item => item.stable)?.loaderVersion ?? '';
}
