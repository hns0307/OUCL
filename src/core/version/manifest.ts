import { identifier, record, requireMetadata } from './validation.js';

export type ManifestType = 'release' | 'snapshot' | 'old_alpha' | 'old_beta';
export interface ManifestEntry { id: string; type: ManifestType; url: string; sha1: string; releaseTime: string }
/** Restricts metadata lookup to official HTTPS origins; mirror addresses cannot become trust anchors. */
export function isOfficialMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const descriptor = /^\/v1\/packages\/[a-f0-9]{40}\/([^/]+)\.json$/.exec(url.pathname);
    const knownPath = url.pathname === '/mc/game/version_manifest_v2.json' || descriptor !== null && identifier(decodeURIComponent(descriptor[1]!));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && ['piston-meta.mojang.com', 'launchermeta.mojang.com'].includes(url.hostname)
      && knownPath;
  } catch { return false; }
}
/** Reads bounded official catalog facts, rejecting duplicate identities and non-official descriptor URLs. */
export function parseManifest(value: unknown): ManifestEntry[] {
  requireMetadata(record(value) && Array.isArray(value.versions) && value.versions.length > 0 && value.versions.length <= 20000);
  const seen = new Set<string>();
  return value.versions.map((item: unknown) => {
    requireMetadata(record(item) && identifier(item.id) && !seen.has(item.id)
      && typeof item.type === 'string' && ['release', 'snapshot', 'old_alpha', 'old_beta'].includes(item.type)
      && typeof item.url === 'string' && item.url.length <= 2048 && isOfficialMetadataUrl(item.url)
      && typeof item.sha1 === 'string' && /^[a-fA-F0-9]{40}$/.test(item.sha1)
      && typeof item.releaseTime === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(item.releaseTime)
      && Number.isFinite(Date.parse(item.releaseTime)));
    seen.add(item.id);
    return { id: item.id, type: item.type as ManifestType, url: item.url, sha1: item.sha1.toLowerCase(), releaseTime: new Date(item.releaseTime).toISOString() };
  });
}
