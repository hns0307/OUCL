import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientVersion } from '../src/core/version/resolve.js';
import { parseArtifact, parseClientVersion, parseRules, VersionError } from '../src/core/version/validation.js';
import { rulesAllow, selectArguments, substituteArguments, tokenizeLegacyArguments } from '../src/core/version/arguments.js';
import type { VersionEnvironment } from '../src/core/version/types.js';

const artifact = { url: 'https://libraries.minecraft.net/a.jar', sha1: 'a'.repeat(40), size: 12, path: 'org/example/a/1/a-1.jar' };
const client = { url: 'https://piston-data.mojang.com/client.jar', sha1: 'b'.repeat(40), size: 200 };
const environment: VersionEnvironment = { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} };
const base = { id: 'base', mainClass: 'net.minecraft.client.main.Main', downloads: { client },
  libraries: [{ name: 'org.example:lib:1', downloads: { artifact } }],
  javaVersion: { majorVersion: 21 }, assetIndex: { ...artifact, id: '17' }, assets: '17',
  arguments: { game: ['--username', '${auth_player_name}'], jvm: ['-cp', '${classpath}'] } };

function errorCode(code: string): (error: unknown) => boolean { return error => error instanceof VersionError && error.code === code; }

test('vanilla metadata resolves typed artifacts and arguments without mutating input', () => {
  const before = JSON.stringify(base);
  const resolved = resolveClientVersion('base', { base }, environment);
  assert.equal(resolved.mainClass, base.mainClass); assert.equal(resolved.javaMajor, 21);
  assert.deepEqual(resolved.ancestry, ['base']); assert.equal(resolved.jarVersionId, 'base');
  assert.equal(resolved.assetIndex?.id, '17'); assert.equal(resolved.assets, '17'); assert.equal(resolved.type, 'release');
  assert.equal(resolved.assetIndexVersionId, 'base');
  assert.deepEqual(resolved.gameArguments, ['--username', '${auth_player_name}']);
  assert.deepEqual(resolved.jvmArguments, ['-cp', '${classpath}']);
  assert.equal(resolved.libraries[0]?.artifact?.sha1, artifact.sha1);
  assert.equal(resolved.libraries[0]?.sourceVersionId, 'base');
  assert.equal(JSON.stringify(base), before);
});

test('three-level inheritance overrides libraries by coordinate and finds nearest client jar', () => {
  const middle = { id: 'middle', inheritsFrom: 'base', mainClass: 'custom.Main', type: 'snapshot', libraries: [
    { name: 'org.example:lib:2', downloads: { artifact: { ...artifact, sha1: 'c'.repeat(40) } } },
    { name: 'org.example:lib:2:tests', downloads: { artifact } }, { name: 'org.example:lib:2@zip', downloads: { artifact } },
  ], arguments: { game: ['--middle'], jvm: ['-Dmiddle=true'] } };
  const leaf = { id: 'leaf', inheritsFrom: 'middle', arguments: { game: ['--leaf'] } };
  const resolved = resolveClientVersion('leaf', { base, middle, leaf }, environment);
  assert.deepEqual(resolved.ancestry, ['base', 'middle', 'leaf']); assert.equal(resolved.jarVersionId, 'base');
  assert.equal(resolved.mainClass, 'custom.Main'); assert.equal(resolved.type, 'snapshot');
  assert.deepEqual(resolved.libraries.map(item => item.name), ['org.example:lib:2', 'org.example:lib:2:tests', 'org.example:lib:2@zip']);
  assert.deepEqual(resolved.libraries.map(item => item.sourceVersionId), ['middle', 'middle', 'middle']);
  assert.equal(resolved.assetIndexVersionId, 'base');
  assert.deepEqual(resolved.gameArguments, ['--username', '${auth_player_name}', '--middle', '--leaf']);
  assert.equal(resolveClientVersion('middle', { base, middle: { ...middle, downloads: { client: { ...client, size: 300 } } } }, environment).jarVersionId, 'middle');
});

test('inheritance rejects cycles, missing parents, mismatched ids and more than 32 records', () => {
  assert.throws(() => resolveClientVersion('absent', {}, environment), errorCode('MISSING_PARENT'));
  assert.throws(() => resolveClientVersion('a', { a: { id: 'a', inheritsFrom: 'b' }, b: { id: 'b', inheritsFrom: 'a' } }, environment), errorCode('CIRCULAR_INHERITANCE'));
  assert.throws(() => resolveClientVersion('bad', { bad: { ...base } }, environment), errorCode('INVALID_METADATA'));
  const documents: Record<string, unknown> = {};
  for (let index = 0; index < 33; index++) documents[`v${index}`] = { id: `v${index}`, inheritsFrom: `v${index + 1}` };
  assert.throws(() => resolveClientVersion('v0', documents, environment), errorCode('INHERITANCE_LIMIT'));
  assert.throws(() => resolveClientVersion('../bad', {}, environment), errorCode('INVALID_METADATA'));
});

test('server-only input cannot provide a client or main class', () => {
  assert.throws(() => resolveClientVersion('server', { server: { id: 'server', downloads: { server: client } } }, environment), errorCode('CLIENT_NOT_FOUND'));
  assert.throws(() => resolveClientVersion('empty', { empty: { id: 'empty', downloads: { client } } }, environment), errorCode('MAIN_CLASS_MISSING'));
  const minimal = resolveClientVersion('base', { base: { id: 'base', mainClass: 'Main', downloads: { client } } }, environment);
  assert.equal(minimal.javaMajor, 8); assert.equal(minimal.assetIndex, undefined); assert.deepEqual(minimal.libraries, []);
  assert.equal(minimal.assetIndexVersionId, undefined);
});

test('library and asset-index provenance follows each actual declaration independently of the selected leaf', () => {
  const native = { ...artifact, path: 'org/example/native/1/native.jar', sha1: 'd'.repeat(40) };
  const parent = { ...base, libraries: [...base.libraries,
    { name: 'org.example:native:1', natives: { windows: 'natives-windows' }, downloads: { classifiers: { 'natives-windows': native } } }] };
  const middle = { id: 'middle', inheritsFrom: 'base', assetIndex: { ...base.assetIndex, id: '18' }, libraries: [
    { name: 'org.example:lib:2', downloads: { artifact: { ...artifact, sha1: 'e'.repeat(40) } } }
  ] };
  const leaf = { id: 'leaf', inheritsFrom: 'middle', libraries: [
    { name: 'org.example:leaf:1', downloads: { artifact } }
  ] };
  const resolved = resolveClientVersion('leaf', { base: parent, middle, leaf }, environment);
  assert.equal(resolved.jarVersionId, 'base');
  assert.equal(resolved.assetIndex?.id, '18'); assert.equal(resolved.assetIndexVersionId, 'middle');
  assert.deepEqual(resolved.libraries.map(item => [item.name, item.sourceVersionId]), [
    ['org.example:lib:2', 'middle'], ['org.example:native:1', 'base'], ['org.example:leaf:1', 'leaf']
  ]);
  assert.equal(resolved.libraries[1]?.native?.sha1, native.sha1);
  const leafOverride = resolveClientVersion('leaf', { base: parent, middle, leaf: { ...leaf, assetIndex: { ...base.assetIndex, id: '19' },
    libraries: [{ name: 'org.example:native:2', natives: { windows: 'natives-windows' }, downloads: { classifiers: { 'natives-windows': native } } }] } }, environment);
  assert.equal(leafOverride.assetIndexVersionId, 'leaf');
  assert.equal(leafOverride.libraries.find(item => item.name === 'org.example:native:2')?.sourceVersionId, 'leaf');
});

test('ordered rules default to deny, apply last match and distinguish feature false', () => {
  assert.equal(rulesAllow(undefined, environment), true); assert.equal(rulesAllow([], environment), false);
  const rules = parseRules([{ action: 'allow' }, { action: 'disallow', os: { name: 'windows' } },
    { action: 'allow', os: { name: 'windows', arch: 'x64', version: '^10\\.' }, features: { is_demo_user: false } }]);
  assert.equal(rulesAllow(rules, environment), true);
  assert.equal(rulesAllow(rules, { ...environment, features: { is_demo_user: true } }), false);
  assert.equal(rulesAllow([{ action: 'allow', os: { name: 'osx' } }], environment), false);
  assert.equal(rulesAllow([{ action: 'allow', os: { arch: 'x86' } }], environment), false);
  assert.equal(rulesAllow([{ action: 'allow', os: { version: '^11' } }], environment), false);
  assert.equal(rulesAllow(parseRules([{ action: 'allow', features: { toString: false } }]), environment), true);
  assert.throws(() => rulesAllow([{ action: 'allow', os: { version: '[' } }], environment), errorCode('INVALID_RULE_PATTERN'));
  assert.throws(() => rulesAllow([{ action: 'allow', os: { version: '(a+)+' } }], environment), errorCode('INVALID_RULE_PATTERN'));
  assert.throws(() => rulesAllow([{ action: 'allow', os: { arch: 'a'.repeat(129) } }], environment), errorCode('INVALID_RULE_PATTERN'));
});

test('conditional game/JVM arguments filter complete values without shell splitting', () => {
  const metadata = parseClientVersion({ id: 'conditional', arguments: { game: ['plain',
    { rules: [{ action: 'allow', features: { custom: true } }], value: '--feature' },
    { rules: [{ action: 'allow' }], value: ['--path', 'C:\\中文 space'] }], jvm: [] } });
  const argumentsList = metadata.arguments?.game ?? [];
  assert.deepEqual(selectArguments(argumentsList, environment), ['plain', '--path', 'C:\\中文 space']);
  assert.deepEqual(selectArguments(argumentsList, { ...environment, features: { custom: true } }), ['plain', '--feature', '--path', 'C:\\中文 space']);
  assert.deepEqual(selectArguments([{ rules: [{ action: 'allow' }], value: 'one' }], environment), ['one']);
});

test('natives choose bitness classifier and preserve excludes; unrelated OS libraries filtered', () => {
  const nativeLibrary = { name: 'org.lwjgl:lwjgl:2.9.0', natives: { windows: 'natives-windows-${arch}' },
    downloads: { classifiers: { 'natives-windows-64': artifact, 'natives-windows-32': { ...artifact, size: 32 } } }, extract: { exclude: ['META-INF/'] } };
  const metadata = { ...base, libraries: [nativeLibrary, { name: 'org.example:mac:1', rules: [{ action: 'allow', os: { name: 'osx' } }] }] };
  const resolved = resolveClientVersion('base', { base: metadata }, environment);
  assert.equal(resolved.libraries.length, 1); assert.equal(resolved.libraries[0]?.nativeClassifier, 'natives-windows-64');
  assert.deepEqual(resolved.libraries[0]?.nativeExcludes, ['META-INF/']);
  assert.equal(resolveClientVersion('base', { base: metadata }, { ...environment, arch: 'x86' }).libraries[0]?.native?.size, 32);
  assert.throws(() => resolveClientVersion('base', { base: { ...base, libraries: [{ ...nativeLibrary, downloads: {} }] } }, environment), errorCode('NATIVE_NOT_FOUND'));
});

test('legacy tokenization preserves paths, spaces, empty arguments, escaped quotes and child replacement', () => {
  assert.deepEqual(tokenizeLegacyArguments('--path "C:\\中文 space" --name \'Alice Bob\' ""'), ['--path', 'C:\\中文 space', '--name', 'Alice Bob', '']);
  assert.deepEqual(tokenizeLegacyArguments(' "a\\"b"\t\'a"b\'  tail\\ '), ['a"b', 'a"b', 'tail\\']);
  assert.deepEqual(tokenizeLegacyArguments(''), []);
  assert.throws(() => tokenizeLegacyArguments('"unterminated'), errorCode('INVALID_LEGACY_ARGUMENTS'));
  assert.throws(() => tokenizeLegacyArguments('x'.repeat(32769)), errorCode('INVALID_METADATA'));
  assert.throws(() => tokenizeLegacyArguments('x '.repeat(4097)), errorCode('INVALID_METADATA'));
  const documents = { base: { ...base, arguments: undefined, minecraftArguments: '--old one' },
    child: { id: 'child', inheritsFrom: 'base', minecraftArguments: '--new "two words"' } };
  assert.deepEqual(resolveClientVersion('child', documents, environment).gameArguments, ['--new', 'two words']);
});

test('literal placeholders preserve arguments and reject absent/inherited/recursive bindings', () => {
  assert.deepEqual(substituteArguments(['--path=${path}', '${name}', '$literal'], { path: 'C:\\中文 space', name: '$&;$(x)' }), ['--path=C:\\中文 space', '$&;$(x)', '$literal']);
  for (const [tokens, bindings] of [[['${absent}'], {}], [['${toString}'], {}], [['${x}'], { x: '${again}' }], [['${broken'], {}], [['${x}'], { x: 'x'.repeat(32769) }]] as const) {
    assert.throws(() => substituteArguments(tokens, bindings), VersionError);
  }
});

test('artifact validation rejects missing trust facts and unsafe relative paths', () => {
  assert.equal(parseArtifact({ ...artifact, sha1: 'A'.repeat(40) }).sha1, 'a'.repeat(40));
  for (const invalid of [null, {}, { ...artifact, url: 'bad' }, { ...artifact, url: 'http://example.org/a.jar' }, { ...artifact, url: 'https://name:secret@example.org/a' },
    { ...artifact, sha1: 'wrong' }, { ...artifact, size: -1 }, { ...artifact, size: Infinity }, { ...artifact, path: '../a' }, { ...artifact, path: '/a' },
    { ...artifact, path: 'C:/a' }, { ...artifact, path: 'a\\b' }, { ...artifact, path: 'a//b' }]) assert.throws(() => parseArtifact(invalid), errorCode('INVALID_METADATA'));
});

test('upstream malformed descriptors are rejected at the pure boundary', () => {
  for (const invalid of [null, [], {}, { id: '..' }, { id: 'a', inheritsFrom: '../b' }, { id: 'a', mainClass: 9 },
    { id: 'a', mainClass: '--bad' }, { id: 'a', assets: '../assets' },
    { id: 'a', javaVersion: null }, { id: 'a', javaVersion: { majorVersion: -1 } }, { id: 'a', downloads: [] },
    { id: 'a', assetIndex: { ...artifact, id: '..' } }, { id: 'a', libraries: {} }, { id: 'a', libraries: [{ name: '../bad' }] },
    { id: 'a', libraries: [{ name: 'a:b:1', downloads: [] }] }, { id: 'a', libraries: [{ name: 'a:b:1', downloads: { classifiers: [] } }] },
    { id: 'a', libraries: [{ name: 'a:b:1', natives: { windows: 3 } }] }, { id: 'a', libraries: [{ name: 'a:b:1', extract: { exclude: [1] } }] },
    { id: 'a', arguments: { game: [{ rules: [], value: [5] }] } }, { id: 'a', arguments: { game: [] }, minecraftArguments: '--duplicate' }]) {
    assert.throws(() => parseClientVersion(invalid), errorCode('INVALID_METADATA'));
  }
  for (const rules of [null, [{}], [{ action: 'unknown' }], [{ action: 'allow', os: [] }], [{ action: 'allow', os: { arch: 4 } }], [{ action: 'allow', features: { flag: 'yes' } }]]) {
    assert.throws(() => parseRules(rules), errorCode('INVALID_METADATA'));
  }
});

test('large inherited argument and library sets stop at bounded aggregate limits', () => {
  const over = { id: 'over', inheritsFrom: 'base', arguments: { game: Array.from({ length: 4096 }, () => 'x') } };
  assert.throws(() => resolveClientVersion('over', { base, over }, environment), errorCode('INVALID_METADATA'));
  const child = { id: 'child', inheritsFrom: 'base', libraries: Array.from({ length: 10000 }, (_, index) => ({ name: `group:a${index}:1` })) };
  assert.throws(() => resolveClientVersion('child', { base, child }, environment), errorCode('INVALID_METADATA'));
});
