import { childPath, planClasspath } from '../path/layout.js';
import type { GameLayout } from '../path/layout.js';
import { substituteArguments } from '../version/arguments.js';
import type { ResolvedClientVersion } from '../version/types.js';

export type LaunchPlanCode = 'JAVA_INCOMPATIBLE' | 'MEMORY_OUT_OF_RANGE' | 'INVALID_ACCOUNT' | 'ARGUMENT_CONFLICT' | 'ARGUMENT_LIMIT';
/** Fixed, path-free planning errors; the service maps these to localized messages. */
export class LaunchPlanError extends Error {
  readonly category = 'validation';
  constructor(readonly code: LaunchPlanCode) { super(code); this.name = 'LaunchPlanError'; }
}
export interface LaunchInput {
  version: ResolvedClientVersion; layout: GameLayout; classpath: readonly string[];
  java: { javaId: string; major: 8 | 17 | 21; architecture: 'x64' };
  account: { gameName: string; uuid: string };
  assets: { virtual: boolean }; memoryMiB: number; launcherVersion: string;
}
export interface LaunchPlan { executableRef: string; args: string[]; cwd: string; redactedPreview: string[] }

/** Converts already verified metadata and an already validated offline identity into spawn-array arguments.
 * Does not choose an identity policy, inspect files, resolve a Java path, or launch a process.
 */
export function planOfflineLaunch(input: LaunchInput): LaunchPlan {
  const { version, layout, java, account } = input;
  if (![8, 17, 21].includes(java.major) || java.major !== version.javaMajor || java.architecture !== 'x64'
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(java.javaId)) throw new LaunchPlanError('JAVA_INCOMPATIBLE');
  if (!Number.isSafeInteger(input.memoryMiB) || input.memoryMiB < 512 || input.memoryMiB > 65536) throw new LaunchPlanError('MEMORY_OUT_OF_RANGE');
  if (!account.gameName || account.gameName.length > 80 || /[\p{C}]/u.test(account.gameName)
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(account.uuid)) throw new LaunchPlanError('INVALID_ACCOUNT');
  if (!/^[A-Za-z0-9][A-Za-z0-9.+-]{0,79}$/.test(input.launcherVersion)) throw new LaunchPlanError('ARGUMENT_CONFLICT');
  const assetId = version.assetIndex?.id ?? version.assets;
  if (!assetId || version.jvmArguments.some(value => /^-Xm[sx]|^-jar$|^@|^-javaagent:|^-agent(?:lib|path):/i.test(value))) throw new LaunchPlanError('ARGUMENT_CONFLICT');
  const uuid = account.uuid.replaceAll('-', '').toLowerCase();
  const bindings: Record<string, string> = {
    auth_player_name: account.gameName, auth_uuid: uuid, auth_access_token: '0', auth_session: `token:0:${uuid}`,
    user_type: 'legacy', user_properties: '{}', auth_xuid: '0', clientid: '0',
    version_name: version.id, version_type: version.type,
    game_directory: layout.gameDirectory, assets_root: layout.assetsDirectory, assets_index_name: assetId,
    game_assets: input.assets.virtual ? childPath(layout.assetsDirectory, `virtual/${assetId}`) : layout.assetsDirectory,
    natives_directory: layout.nativesDirectory, jna_directory: childPath(layout.versionDirectory, '.oucl-launch/jna'), library_directory: layout.librariesDirectory,
    native_work_directory: childPath(layout.versionDirectory, '.oucl-launch/native-cache'),
    classpath: planClasspath(layout, input.classpath), classpath_separator: ';',
    launcher_name: 'OUCL', launcher_version: input.launcherVersion, resolution_width: '854', resolution_height: '480',
  };
  const jvm = version.jvmArguments.map(value => value === '-Djna.tmpdir=${natives_directory}' ? '-Djna.tmpdir=${jna_directory}'
    : ['-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives_directory}', '-Dio.netty.native.workdir=${natives_directory}'].includes(value)
      ? value.replace('${natives_directory}', '${native_work_directory}') : value);
  if (!jvm.some(value => value.startsWith('-Djna.tmpdir='))) jvm.push('-Djna.tmpdir=${jna_directory}');
  const classpathFlags = jvm.filter(value => ['-cp', '-classpath', '--class-path'].includes(value));
  if (classpathFlags.length === 0) jvm.push('-cp', '${classpath}');
  else if (classpathFlags.length !== 1 || jvm[jvm.indexOf(classpathFlags[0]!) + 1] !== '${classpath}') throw new LaunchPlanError('ARGUMENT_CONFLICT');
  const nativeFlags = jvm.filter(value => value.startsWith('-Djava.library.path='));
  if (nativeFlags.length === 0) jvm.push('-Djava.library.path=${natives_directory}');
  else if (nativeFlags.length !== 1 || nativeFlags[0] !== '-Djava.library.path=${natives_directory}') throw new LaunchPlanError('ARGUMENT_CONFLICT');
  const tokens = [`-Xms${Math.min(512, input.memoryMiB)}M`, `-Xmx${input.memoryMiB}M`, ...jvm, version.mainClass, ...version.gameArguments];
  const args = substituteArguments(tokens, bindings);
  // Conservative UTF-16 Windows command-line budget, including quoting/backslash expansion.
  if (args.length > 4096 || args.reduce((length, value) => length + value.length + (value.match(/[\\"]/g)?.length ?? 0) + 3, 1024) > 32767
    || args.some(value => /[\0\r\n]/.test(value))) throw new LaunchPlanError('ARGUMENT_LIMIT');
  const preview = { ...bindings };
  for (const name of ['auth_player_name', 'auth_uuid', 'auth_access_token', 'auth_session', 'auth_xuid', 'clientid']) preview[name] = '<redacted>';
  for (const name of ['game_directory', 'assets_root', 'game_assets', 'natives_directory', 'jna_directory', 'native_work_directory', 'library_directory', 'classpath']) preview[name] = '<managed-path>';
  return { executableRef: java.javaId, args, cwd: layout.gameDirectory, redactedPreview: substituteArguments(tokens, preview) };
}
