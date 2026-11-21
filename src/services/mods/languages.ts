import path from 'node:path';
import { loaderLanguageCandidates } from '../../core/loaders/languages.js';
import type { InstanceRecord } from '../storage/instance-records.js';
import type { ModArchiveReader } from '../workers/mod-archive-reader.js';
import { ModInventoryError } from './inventory.js';

/** Rehashes the real official component object before admitting its known built-in language version. */
export class InstalledLanguageReader {
  constructor(private readonly scanner: Pick<ModArchiveReader, 'read'>) {}
  async read(dataDirectory: string, record: InstanceRecord, signal?: AbortSignal): Promise<Record<string, string>> {
    const loader = record.metadata?.loader;
    if (!loader || loader.kind !== 'forge' && loader.kind !== 'neoforge') return {};
    const candidates = loaderLanguageCandidates(loader.kind, record.summary.mcVersionId, loader.version, loader.libraries.map(library => library.path));
    const result: Record<string, string> = {};
    for (const candidate of candidates) {
      const library = loader.libraries.find(library => library.path === candidate.path)!;
      const object = record.objects?.[`sha1-${library.spec.expected.digest}`];
      if (!object || object.size !== library.spec.expected.size) throw new ModInventoryError('SCAN_FAILED');
      const file = path.join(dataDirectory, 'store/objects/sha256', object.digest.slice(0, 2), object.digest);
      const scan = await this.scanner.read(file, signal);
      if (scan.sha256 !== object.digest || scan.sha1 !== library.spec.expected.digest || scan.size !== object.size) throw new ModInventoryError('SCAN_FAILED');
      Object.assign(result, candidate.versions);
    }
    return result;
  }

  /** Reads Quilt's explicitly provided Fabric Loader version from its verified official JAR. */
  async readRuntime(dataDirectory: string, record: InstanceRecord, signal?: AbortSignal): Promise<string | null> {
    const loader = record.metadata?.loader;
    if (!loader || loader.kind !== 'quilt') return null;
    const expectedPath = `org/quiltmc/quilt-loader/${loader.version}/quilt-loader-${loader.version}.jar`;
    const matches = loader.libraries.filter(library => library.path === expectedPath);
    if (matches.length !== 1) return null;
    const library = matches[0]!; const object = record.objects?.[`sha1-${library.spec.expected.digest}`];
    if (!object || object.size !== library.spec.expected.size) return null;
    const file = path.join(dataDirectory, 'store/objects/sha256', object.digest.slice(0, 2), object.digest);
    const scan = await this.scanner.read(file, signal);
    if (scan.sha256 !== object.digest || scan.sha1 !== library.spec.expected.digest || scan.size !== object.size) throw new ModInventoryError('SCAN_FAILED');
    const declarations = scan.archives.filter(archive => archive.entries.length === 0).flatMap(archive => archive.declarations)
      .filter(declaration => declaration.format === 'quilt' && declaration.issues.length === 0);
    const mods = declarations.flatMap(declaration => declaration.mods).filter(mod => mod.id === 'quilt_loader' && mod.version === loader.version && mod.issues.length === 0);
    if (mods.length !== 1) return null;
    const provided = mods[0]!.provides.filter(item => item.id === 'fabricloader');
    return provided.length === 1 ? provided[0]!.version : null;
  }
}
