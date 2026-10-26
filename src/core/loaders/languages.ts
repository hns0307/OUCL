import type { InstallerLoaderKind } from './types.js';
export interface LoaderLanguageCandidate { path: string; versions: Record<string, string> }

/** Identifies built-in provider artifacts for the representative matrix, before any IO or trust claim.
 * Forge's provider version is its major; NeoForge FML is independently versioned by the loader artifact.
 */
export function loaderLanguageCandidates(kind: InstallerLoaderKind, minecraft: string, loaderVersion: string,
  paths: readonly string[]): LoaderLanguageCandidate[] {
  if (paths.length > 256) return [];
  if (kind === 'forge' && minecraft === '1.20.1' && /^47\.\d+\.\d+$/.test(loaderVersion)) {
    const version = `${minecraft}-${loaderVersion}`;
    return [['javafmllanguage', 'javafml'], ['lowcodelanguage', 'lowcodefml']].flatMap(([artifact, id]) => {
      const expected = `net/minecraftforge/${artifact}/${version}/${artifact}-${version}.jar`;
      return paths.filter(path => path === expected).length === 1 ? [{ path: expected, versions: { [id!]: '47' } }] : [];
    });
  }
  if (kind === 'neoforge' && minecraft === '1.21.1' && /^21\.1\.\d+$/.test(loaderVersion)) {
    const matching = paths.flatMap(path => {
      const match = /^net\/neoforged\/fancymodloader\/loader\/(4\.0\.\d+)\/loader-\1\.jar$/.exec(path);
      return match ? [{ path, versions: { javafml: match[1]!, lowcodefml: match[1]! } }] : [];
    });
    return matching.length === 1 ? matching : [];
  }
  return [];
}
