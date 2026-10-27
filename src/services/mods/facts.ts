import { createHash } from 'node:crypto';
import type { LocalModArchive } from '../../core/mods/check.js';
import type { PlatformLocalMod } from '../../core/mods/platform.js';
import type { ModArchiveScan } from './archive.js';
import type { ModInventoryItem } from './inventory.js';

/** Projects bounded archive observations identically for installed and not-yet-installed JARs. */
export function archiveFacts(scan: ModArchiveScan): LocalModArchive[] {
  return scan.archives.map(archive => ({ entries: archive.entries, declarations: archive.declarations,
    jarJar: archive.documents.some(document => document.name === 'META-INF/jarjar/metadata.json') }));
}
export function plannedModFacts(instanceId: string, filename: string, scan: ModArchiveScan): ModInventoryItem {
  return { fileId: createHash('sha256').update(JSON.stringify({ instanceId, filename })).digest('hex'), filename, enabled: true,
    size: scan.size, sha1: scan.sha1, sha256: scan.sha256, sha512: scan.sha512, archives: archiveFacts(scan), issues: [] };
}
export function platformFacts(items: readonly ModInventoryItem[]): PlatformLocalMod[] {
  return items.map(item => ({ fileId: item.fileId, enabled: item.enabled, size: item.size, sha1: item.sha1, sha512: item.sha512,
    formats: item.archives.find(archive => !archive.entries.length)?.declarations.map(declaration => declaration.format) ?? [],
    unresolvedEmbedded: item.archives.some(archive => archive.jarJar || archive.entries.length > 0) }));
}
