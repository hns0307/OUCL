import { UUID_PATTERN } from '../../shared/contracts/handshake.js';

export type LayoutErrorCode = 'INVALID_PATH' | 'INVALID_ID' | 'ROOT_ESCAPE' | 'ISOLATION_REQUIRED';
/** A redacted pure-planning error; no actual filesystem state is inspected. */
export class LayoutError extends Error {
  readonly category = 'validation';
  constructor(readonly code: LayoutErrorCode) { super(code); this.name = 'LayoutError'; }
}

export interface IsolationSettings { globalDefault: boolean; instance: 'inherit' | 'on' | 'off'; pack: boolean }
export interface VersionLocation { directoryId: string; versionRecordId: string }
export interface LayoutInput extends VersionLocation {
  dataDirectory: string; rootId: string; instanceId: string; mcVersionId: string;
  isolation: IsolationSettings; jar: VersionLocation;
}
export interface GameLayout {
  rootId: string; instanceId: string; mcVersionId: string; isolated: boolean; forcedIsolation: boolean;
  dataDirectory: string; storeDirectory: string; gameRoot: string; versionDirectory: string;
  gameDirectory: string; assetsDirectory: string; librariesDirectory: string; nativesDirectory: string;
  versionJson: string; instanceJson: string; localJar: string; jar: string;
}

/** Rejects reserved Windows names, streams and ambiguous trailing characters. */
export function validateComponent(value: string): string {
  if (value.length === 0 || value.length > 255 || value === '.' || value === '..'
    || /[<>:"/\\|?*;]/.test(value) || /[. ]$/.test(value) || [...value].some(character => character.charCodeAt(0) < 32)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new LayoutError('INVALID_PATH');
  return value;
}

/** Canonical lexical form for a selected local Windows volume; no realpath claim. */
export function normalizeDataDirectory(input: string): string {
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(input);
  if (!match || input.length > 32760) throw new LayoutError('INVALID_PATH');
  const parts = (match[2] ?? '').split(/[\\/]+/).filter(Boolean).map(validateComponent);
  return `${(match[1] ?? '').toUpperCase()}:\\${parts.join('\\')}`;
}

/** Joins bounded relative artifact names without allowing absolute or parent paths. */
export function childPath(root: string, relative: string): string {
  if (relative.startsWith('/') || relative.startsWith('\\') || relative.includes(':')) throw new LayoutError('ROOT_ESCAPE');
  const parts = relative.split(/[\\/]/).map(validateComponent);
  const base = normalizeDataDirectory(root);
  const output = `${base.endsWith('\\') ? base : base + '\\'}${parts.join('\\')}`;
  if (output.length > 32760) throw new LayoutError('INVALID_PATH');
  return output;
}

/** Applies pack > instance override > global isolation, without moving data. */
export function isolationPolicy(settings: IsolationSettings): { isolated: boolean; forced: boolean } {
  return { isolated: settings.pack || (settings.instance === 'inherit' ? settings.globalDefault : settings.instance === 'on'), forced: settings.pack };
}

function managedId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,159}$/.test(value)) throw new LayoutError('INVALID_ID');
  return validateComponent(value);
}

/** Computes only controlled locations; the host must validate real targets and locks. */
export function planGameLayout(input: LayoutInput): GameLayout {
  if (!UUID_PATTERN.test(input.rootId) || !UUID_PATTERN.test(input.instanceId)) throw new LayoutError('INVALID_ID');
  managedId(input.mcVersionId);
  const dataDirectory = normalizeDataDirectory(input.dataDirectory);
  const gameRoot = childPath(dataDirectory, `roots/${input.rootId}/.minecraft`);
  const versionDirectory = childPath(gameRoot, `versions/${managedId(input.directoryId)}`);
  const record = managedId(input.versionRecordId);
  const jar = childPath(gameRoot, `versions/${managedId(input.jar.directoryId)}/${managedId(input.jar.versionRecordId)}.jar`);
  const isolation = isolationPolicy(input.isolation);
  return {
    rootId: input.rootId, instanceId: input.instanceId, mcVersionId: input.mcVersionId,
    isolated: isolation.isolated, forcedIsolation: isolation.forced, dataDirectory,
    storeDirectory: childPath(dataDirectory, 'store'), gameRoot, versionDirectory,
    gameDirectory: isolation.isolated ? versionDirectory : gameRoot,
    assetsDirectory: childPath(gameRoot, 'assets'), librariesDirectory: childPath(gameRoot, 'libraries'),
    nativesDirectory: childPath(versionDirectory, 'natives'), versionJson: childPath(versionDirectory, `${record}.json`),
    instanceJson: childPath(versionDirectory, 'oucl.instance.json'), localJar: childPath(versionDirectory, `${record}.jar`), jar,
  };
}

/** Builds absolute Windows classpath entries without using cwd/gameDir resolution. */
export function planClasspath(layout: GameLayout, relativeLibraries: readonly string[]): string {
  return [...relativeLibraries.map(file => childPath(layout.librariesDirectory, file)), layout.jar].join(';');
}

/** Maps local SHA256 identity to its object location; does not establish trust. */
export function objectPath(dataDirectory: string, sha256: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) throw new LayoutError('INVALID_ID');
  const id = sha256.toLowerCase();
  return childPath(dataDirectory, `store/objects/sha256/${id.slice(0, 2)}/${id}`);
}

/** Previews a mode switch while explicitly leaving existing player files in place. */
export function planIsolationChange(settings: IsolationSettings, requested: 'on' | 'off') {
  if (settings.pack && requested === 'off') throw new LayoutError('ISOLATION_REQUIRED');
  return { isolated: isolationPolicy({ ...settings, instance: requested }).isolated, willMigrate: false as const, existingDataRemains: true as const };
}

/** Lists safe plan candidates only; dependency/realpath checks remain mandatory. */
export function planInstanceRemoval(layout: GameLayout, preserveVersionDependency: boolean) {
  const privateNames = ['mods', 'config', 'defaultconfigs', 'saves', 'resourcepacks', 'shaderpacks', 'logs',
    'crash-reports', 'screenshots', 'natives', 'options.txt', 'servers.dat', 'oucl.instance.json'];
  const versionRecords = [layout.versionJson, layout.localJar];
  return {
    privateTargets: privateNames.map(name => childPath(layout.versionDirectory, name)),
    versionRecordTargets: preserveVersionDependency ? [] : versionRecords,
    protectedTargets: [layout.storeDirectory, layout.assetsDirectory, layout.librariesDirectory,
      childPath(layout.gameRoot, 'launcher_profiles.json'), ...(preserveVersionDependency ? versionRecords : []),
      ...(layout.jar !== layout.localJar ? [layout.jar] : []),
      ...['mods', 'config', 'saves', 'logs', 'options.txt', 'servers.dat'].map(name => childPath(layout.gameRoot, name))],
    followLinks: false as const, requiresDependencyCheck: true as const,
  };
}
