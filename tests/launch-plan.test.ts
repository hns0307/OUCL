import test from 'node:test';
import assert from 'node:assert/strict';
import { planLaunch, planOfflineLaunch } from '../src/core/launch/plan.js';
import type { LaunchInput } from '../src/core/launch/plan.js';
import { planGameLayout } from '../src/core/path/layout.js';
import { resolveClientVersion } from '../src/core/version/resolve.js';

const id = '00000000-0000-4000-8000-000000000001';
function sample(): LaunchInput {
  const version = resolveClientVersion('1.20.1', { '1.20.1': { id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', javaVersion: { majorVersion: 17 },
    assets: '5', downloads: { client: { url: 'https://piston-data.mojang.com/client.jar', size: 1, sha1: 'a'.repeat(40) } },
    arguments: { jvm: ['-cp', '${classpath}', '-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}'],
      game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}'] } } },
  { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
  const layout = planGameLayout({ dataDirectory: 'D:\\Game Folder', rootId: id, instanceId: id, mcVersionId: '1.20.1', directoryId: id, versionRecordId: id,
    jar: { directoryId: 'hidden-parent', versionRecordId: 'parent' }, isolation: { globalDefault: true, instance: 'on', pack: false } });
  return { version, layout, classpath: ['org/example/test/1/test-1.jar'], java: { javaId: id, major: 17, architecture: 'x64' },
    account: { gameName: 'Player One', uuid: id }, assets: { virtual: false }, memoryMiB: 2048, launcherVersion: '0.0.0' };
}
test('modern launch retains one argument per value, absolute Windows paths and inherited client jar', () => {
  const input = sample(); const plan = planOfflineLaunch(input);
  assert.equal(plan.executableRef, id); assert.equal(plan.cwd, input.layout.gameDirectory);
  assert.deepEqual(plan.args.slice(0, 2), ['-Xms512M', '-Xmx2048M']);
  assert.equal(plan.args[plan.args.indexOf('--username') + 1], 'Player One');
  const classpath = plan.args[plan.args.indexOf('-cp') + 1]!;
  assert.equal(classpath, input.layout.librariesDirectory + '\\org\\example\\test\\1\\test-1.jar;' + input.layout.jar);
  assert.equal(plan.args[plan.args.indexOf('--uuid') + 1], id.replaceAll('-', ''));
  assert.equal(plan.args[plan.args.indexOf('--accessToken') + 1], '0');
  const preview = plan.redactedPreview.join(' ');
  assert.equal(preview.includes('Game Folder'), false); assert.equal(preview.includes('Player One'), false); assert.equal(preview.includes(id), false);
  assert.equal(preview.includes('<redacted>'), true);
});
test('online launch separates Microsoft and Yggdrasil parameters and protects preview secrets', () => {
  const input = sample();
  input.version.gameArguments.push('--userType', '${user_type}');
  const microsoft = planLaunch({ ...input, account: { ...input.account, kind: 'microsoft', clientId: id, accessToken: 'private-access', xuid: '12345' } });
  assert.ok(microsoft.args.includes('msa') && microsoft.args.includes('private-access'));
  assert.ok(!microsoft.redactedPreview.join(' ').includes('private-access'));
  assert.equal(microsoft.args.filter(value => value.startsWith('-javaagent:')).length, 0);
  const yggdrasil = { ...input.account, kind: 'yggdrasil' as const, accessToken: 'private-provider', agentPath: 'D:\\OUCL identity\\agent.jar',
    apiRoot: 'https://skin.example.org/api/yggdrasil', prefetchedMetadata: 'e30=' };
  const thirdParty = planLaunch({ ...input, account: yggdrasil });
  assert.ok(thirdParty.args.includes('mojang'));
  assert.deepEqual(thirdParty.args.filter(value => value.startsWith('-javaagent:')), ['-javaagent:' + yggdrasil.agentPath + '=' + yggdrasil.apiRoot]);
  assert.ok(!thirdParty.redactedPreview.join(' ').includes(yggdrasil.apiRoot));
  assert.ok(!thirdParty.redactedPreview.join(' ').includes(yggdrasil.accessToken));
  assert.throws(() => planLaunch({ ...input, account: { ...yggdrasil, apiRoot: 'http://skin.example.org' } }), { code: 'INVALID_ACCOUNT' });
});

test('legacy JVM fallback and virtual assets use the supplied actual game directory', () => {
  const input = sample(); input.version.jvmArguments = []; input.java.major = 8; input.version.javaMajor = 8;
  input.version.gameArguments = ['--session', '${auth_session}', '--gameDir', '${game_directory}', '--assetsDir', '${game_assets}', '--userProperties', '${user_properties}'];
  input.assets.virtual = true; input.layout.gameDirectory = input.layout.gameRoot;
  const plan = planOfflineLaunch(input);
  assert.equal(plan.args.filter(value => value === '-cp').length, 1);
  assert.ok(plan.args.includes('-Djava.library.path=' + input.layout.nativesDirectory));
  assert.ok(plan.args.includes('token:0:' + id.replaceAll('-', '')));
  assert.ok(plan.args.includes(input.layout.assetsDirectory + '\\virtual\\5')); assert.equal(plan.cwd, input.layout.gameRoot);
  assert.ok(plan.args.includes('{}'));
});
test('Forge module exclusion follows the inherited physical client JAR without changing version identity', () => {
  const input = sample(); input.version.id = '1.20.1-forge-47.4.28';
  input.version.jvmArguments.push('-DignoreList=bootstraplauncher,${version_name}.jar');
  input.version.gameArguments.push('--version', '${version_name}');
  const result = planOfflineLaunch(input);
  assert.ok(result.args.includes('-DignoreList=bootstraplauncher,parent.jar'));
  assert.equal(result.args.at(-1), '1.20.1-forge-47.4.28');
  assert.ok(result.redactedPreview.includes('-DignoreList=bootstraplauncher,<managed-jar>'));
});
test('JNA writes temporary DLLs outside the verified native directory', () => {
  const input = sample(); input.version.jvmArguments.push('-Djna.tmpdir=${natives_directory}',
    '-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives_directory}', '-Dio.netty.native.workdir=${natives_directory}');
  const plan = planOfflineLaunch(input);
  assert.ok(plan.args.includes(`-Djna.tmpdir=${input.layout.versionDirectory}\\.oucl-launch\\jna`));
  assert.ok(!plan.args.includes(`-Djna.tmpdir=${input.layout.nativesDirectory}`));
  assert.equal(plan.args.filter(value => value.startsWith('-Djna.tmpdir=')).length, 1);
  assert.ok(plan.args.includes(`-Dorg.lwjgl.system.SharedLibraryExtractPath=${input.layout.versionDirectory}\\.oucl-launch\\native-cache`));
  assert.ok(plan.args.includes(`-Dio.netty.native.workdir=${input.layout.versionDirectory}\\.oucl-launch\\native-cache`));
});
test('Java mismatch, invalid identities, memory and launcher version fail before execution', () => {
  for (const mutate of [
    (x: LaunchInput) => { x.java.major = 21; }, (x: LaunchInput) => { x.java.javaId = 'path'; },
    (x: LaunchInput) => { x.java.architecture = 'arm64' as 'x64'; }, (x: LaunchInput) => { x.java.major = 11 as 17; },
    (x: LaunchInput) => { x.account.gameName = ''; }, (x: LaunchInput) => { x.account.gameName = 'a'.repeat(81); },
    (x: LaunchInput) => { x.account.gameName = 'bad\nname'; }, (x: LaunchInput) => { x.account.uuid = 'bad'; },
    (x: LaunchInput) => { x.memoryMiB = 511; }, (x: LaunchInput) => { x.memoryMiB = 65537; },
    (x: LaunchInput) => { x.memoryMiB = 1024.5; }, (x: LaunchInput) => { x.launcherVersion = 'bad version'; },
  ]) { const input = sample(); mutate(input); assert.throws(() => planOfflineLaunch(input)); }
});
test('conflicting JVM settings, unknown placeholders and oversized argv cannot silently launch', () => {
  for (const jvm of [['-Xmx1G'], ['-Xms1G'], ['-jar'], ['@args'], ['-javaagent:x.jar'], ['-agentlib:test'], ['-agentpath:test'],
    ['-cp', 'foreign'], ['-cp', '${classpath}', '-classpath', '${classpath}'], ['-Djava.library.path=foreign'],
    ['-Djava.library.path=${natives_directory}', '-Djava.library.path=${natives_directory}'], ['${unknown}']]) {
    const input = sample(); input.version.jvmArguments = jvm; assert.throws(() => planOfflineLaunch(input));
  }
  const huge = sample(); huge.version.gameArguments = Array.from({ length: 4097 }, () => 'x'); assert.throws(() => planOfflineLaunch(huge));
  const long = sample(); long.version.gameArguments = ['x'.repeat(32000)]; assert.throws(() => planOfflineLaunch(long));
  const control = sample(); control.version.gameArguments = ['bad\0value']; assert.throws(() => planOfflineLaunch(control));
  const noAssets = sample(); delete noAssets.version.assets; assert.throws(() => planOfflineLaunch(noAssets));
});
test('assetIndex id overrides legacy name and additional official argument bindings are literal', () => {
  const input = sample(); input.version.assetIndex = { id: '7', url: 'https://piston-meta.mojang.com/index', size: 1, sha1: 'a'.repeat(40) };
  input.version.gameArguments = ['${version_name}', '${version_type}', '${assets_index_name}', '${game_assets}', '${user_type}', '${auth_xuid}', '${clientid}',
    '${resolution_width}', '${resolution_height}', '${launcher_version}', '${library_directory}', '${classpath_separator}'];
  const plan = planOfflineLaunch(input);
  assert.deepEqual(plan.args.slice(-12), ['1.20.1', 'release', '7', input.layout.assetsDirectory, 'legacy', '0', '0', '854', '480', '0.0.0', input.layout.librariesDirectory, ';']);
});

test('launch uses only the trusted index alias and matches the virtual resource directory', () => {
  const input = sample(); input.version.assetIndex = { id: '5', url: 'https://piston-meta.mojang.com/index', size: 1, sha1: 'a'.repeat(40) };
  input.version.gameArguments = ['${assets_index_name}', '${game_assets}']; input.assets = { virtual: true, indexId: `5-${'a'.repeat(40)}` };
  assert.deepEqual(planOfflineLaunch(input).args.slice(-2), [input.assets.indexId, `${input.layout.assetsDirectory}\\virtual\\${input.assets.indexId}`]);
  input.assets.indexId = '5-foreign'; assert.throws(() => planOfflineLaunch(input), { code: 'ARGUMENT_CONFLICT' });
});

test('native runtime caches stay private and outside the verified immutable natives', () => {
  const input = sample(); input.version.jvmArguments.push('-Djna.tmpdir=${natives_directory}',
    '-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives_directory}', '-Dio.netty.native.workdir=${natives_directory}');
  const result = planOfflineLaunch(input);
  assert.equal(result.args.filter(value => value.startsWith('-Djna.tmpdir=')).length, 1);
  assert.ok(result.args.includes(`-Djna.tmpdir=${input.layout.versionDirectory}\\.oucl-launch\\jna`));
  assert.ok(result.args.includes(`-Dorg.lwjgl.system.SharedLibraryExtractPath=${input.layout.versionDirectory}\\.oucl-launch\\native-cache`));
  assert.ok(result.args.includes(`-Dio.netty.native.workdir=${input.layout.versionDirectory}\\.oucl-launch\\native-cache`));
  assert.equal(result.redactedPreview.join(' ').includes('Game Folder'), false);
});
